const WebSocket = require('ws');
const net = require("net");
const crypto = require("crypto");
const iconv = require("iconv-lite");
const version = "v0.2.0";
const { servers, tokens, telnet_port, channel, bypassselectscreen } = require("./config.json");

const logo = `  _____ ___ _      _   __  __ ___ ___ _   _ 
|_   _| __| |    /_\\ |  \\/  |_ _/ __| | | |
  | | | _|| |__ / _ \\| |\\/| || |\\__ \\ |_| |
  |_| |___|____/_/ \\_\\_|  |_|___|___/\\___/ `

const logoforcmd = logo.replace(/\n/g, "\r\n")

let server_select = 0
let server_hostname = servers[server_select]
let token = tokens[servers[server_select]]


function getUserInfo() {
    return new Promise((resolve,reject) => {
        // 接続時のウェルカムメッセージ用に自身の情報を写す
        let infoFetchbody = JSON.stringify({ "i": token })
        let userinfo = { name: "", userName: "", id: "", followersCount: -1, followingCount: -1, notesCount: -1 }
        fetch(`https://${server_hostname}/api/i`, { "headers": { "Content-Type": "application/json" }, "method": "POST", "body": infoFetchbody }).then(async (data) => {
            let datatext = await data.text()
            let dataObj = JSON.parse(datatext)
            //console.log(dataObj)
            userinfo.userName = dataObj.username
            userinfo.name = dataObj.name
            userinfo.id = dataObj.id
            userinfo.followingCount = dataObj.followingCount
            userinfo.followersCount = dataObj.followersCount
            userinfo.notesCount = dataObj.notesCount
            resolve(userinfo)
        })
    })
}

// ノートのオブジェクトから内容を簡潔にしたオブジェクトを生成するfunction
// リノートに関してはあまり必要がないため、何も返しません
function createNoteObj(note) {
    let noteText = note.text ?? null
    if ( note.files.length >= 1 ) {
        noteText += "[ " + note.files.length + " 個のファイル ]"
    }
    if ( note.renote && noteText ) {
        // テキストもある、リノートIDもある(引用リノート)
        return { type: "quote", id: note.id, createdAt: note.createdAt, user: {name: note.user.name, username: note.user.username, host: note.user.host}, text: noteText, renote: createNoteObj(note.renote) }
    } else if ( note.reply ) {
        // テキストもある、返信先もある(返信)
        return { type: "reply", id: note.id, createdAt: note.createdAt, user: {name: note.user.name, username: note.user.username, host: note.user.host}, text: noteText, reply: createNoteObj(note.reply) }
    } else if ( noteText ) {
        // テキストがある(ノート)
        return { type: "note", id: note.id, createdAt: note.createdAt, user: {name: note.user.name, username: note.user.username, host: note.user.host}, text: noteText }
    } else if ( note.renote ) {
        // テキストはないけどリノートIDがある、リノートのノートもある(リノート)
        return { type: "renote", id: note.id, createdAt: note.createdAt, user: {name: note.user.name, username: note.user.username, host: note.user.host}, renote: createNoteObj(note.renote) }
    }
    return
}

function addToNoteArray(noteObj) {
    // タイプがリノートで、テキストが含まれていない ではないならプッシュする
    if ( !(noteObj.type === "renote" && !noteObj.text ) ) {
        noteArray.unshift(noteObj)
        selectingNoteNum = selectingNoteNum + 1
    } else {
        return false 
    }
}

function appendNoteQueue() {
    noteArray = noteArrayQueue.concat(noteArray)
    noteArrayQueue = []
}

function noteObjToDisp(noteObj, noteNum = noteArray.length + 1) {
    if ( noteObj ) {
        const createdDate = new Date(noteObj.createdAt)
        if ( noteObj.type === "quote" && noteObj.text && noteObj.renote && noteObj.renote.text ) {
            // テキストもある、リノートIDもある(引用リノート)
            return getUserStringFromUserObj(noteObj.user) + " が引用リノートしました: \r\n" + 
                replaceCrlf(noteObj.text) + "\r\nRN(" + getUserStringFromUserObj(noteObj.renote.user, true) + "): \r\n" + replaceCrlf(noteObj.renote.text) +
                "\r\n" + createdDate.toLocaleString('ja-JP') + " / " + noteNum;
        } else if ( noteObj.type === "reply" && noteObj.text && noteObj.reply && noteObj.reply.text ) {
            // テキストはないけどリノートIDがある、リノートのノートもある(リノート)
            return getUserStringFromUserObj(noteObj.user) + " が返信しました: \r\n" + 
                replaceCrlf(noteObj.text) + "\r\nRE(" + getUserStringFromUserObj(noteObj.reply.user, true) + "): \r\n" + replaceCrlf(noteObj.reply.text) +
                "\r\n" + createdDate.toLocaleString('ja-JP') + " / " + noteNum;
        } else if ( noteObj.type === "note" && noteObj.text ) {
            // テキストがある(ノート)
            return getUserStringFromUserObj(noteObj.user) + " がノートしました: \r\n" + 
                replaceCrlf(noteObj.text) +
                "\r\n" + createdDate.toLocaleString('ja-JP') + " / " + noteNum;
        } else if ( noteObj.type === "renote" && noteObj.renote && noteObj.renote.text) {
            // テキストはないけどリノートのノートがある(リノート)
            return getUserStringFromUserObj(noteObj.user) + " がリノートしました: " + 
                "\r\nRN(" + getUserStringFromUserObj(noteObj.renote.user, true) + "): \r\n" + replaceCrlf(noteObj.renote.text) +
                "\r\n" + createdDate.toLocaleString('ja-JP');
        } else {
            return "不明なノート"
        }
    } else {
        return "不明なノート"
    }
}

/*  
    websocket,コマンドの変数用意
*/
let client

let timeLineChannelUUID = crypto.randomUUID()
let mainChannelUUID = crypto.randomUUID()

let isConnectionSelect = false
let selectingServer = 0
let isCmdMode = false
let isNoteMode = false
let isPostFinalCheck = false
let isSelectMode = false
let selectingNoteNum = 0
let currentWritingNoteArray = []
let wsDisconnected = false
let noteArray = []
let noteArrayQueue = []
let noteActionMode = 0
let currentReactionArray = []
let currentActionNoteObj = {}

function createWSConnection(conn, suppressWelcomeText = false) {
    return new Promise((resolve, reject) => {
        if ( token ) {
            // Misskeyにチャンネルを識別させるためにUUIDを振る
            timeLineChannelUUID = crypto.randomUUID()
            mainChannelUUID = crypto.randomUUID()
            noteArray = []
            client = new WebSocket(`wss://${server_hostname}/streaming?i=${token}`);

            client.on('error', console.error);

            // wsからチャンネルとノートのメッセージが来たなら放流する
            client.on('message', function(msg) {
                console.log("Received: '" + msg + "'");
                const msgObj = JSON.parse(msg)
                const msgBody = msgObj.body
                //console.log(msgbody)
                if ( msgObj.type == "channel") {
                    if ( msgBody.type == "note" ) {
                        // ノートのObjectを生成
                        const noteObj = createNoteObj(msgBody.body)
                        // SJISにエンコード
                        const encodedText = iconv.encode("===============================\r\n" + noteObjToDisp(noteObj) + "\r\n===============================\r\n", 'SJIS')
                        // 送信
                        if ( isCmdMode == false && isNoteMode == false && isSelectMode == false ) {
                            conn.write(encodedText);
                        }
                        
                        addToNoteArray(noteObj)
                    } else if ( msgBody.type == "unreadNotification" ) {
                        let text = `不明な新着通知 TYPE: ${msgBody.body.type}`
                        console.log("\nNEW NOTIFICATION!!!: " + JSON.stringify(msgBody.body) + "\n")
                        if (msgBody.body.type == "quote" && msgBody.body.note.text && msgBody.body.note.renote.text) {
                            text = "新着通知: 引用リノートされました\r\nFROM: " + getUserStringFromUserObj(msgBody.body.user) + "\r\n" + 
                                replaceCrlf(msgBody.body.note.text) + "\r\nRN: " + replaceCrlf(msgBody.body.note.renote.text);
                            
                        } else if (msgBody.body.type == "renote" && msgBody.body.note.renote.text) {
                            text = "新着通知: リノートされました\r\nFROM: " + getUserStringFromUserObj(msgBody.body.user) + "\r\n" + 
                                "RN(You): " + replaceCrlf(msgBody.body.note.renote.text);
                            
                        } else if (msgBody.body.type == "reaction" && msgBody.body.note.text) {
                            text = "新着通知: リアクションされました\r\nFROM: " + getUserStringFromUserObj(msgBody.body.user) + ": " + 
                                msgBody.body.reaction + "\r\nRA: " + replaceCrlf(msgBody.body.note.text);
                            
                        } else if (msgBody.body.type == "reply" && msgBody.body.note.text) {
                            text = "新着通知: 新しい返信が追加されました" + getUserStringFromUserObj(msgBody.body.user) + "\r\n" + 
                                replaceCrlf(msgBody.body.note.text) + "\r\nRE: " + replaceCrlf(msgBody.body.note.reply.text);
                            
                        }
                        const encodedText = iconv.encode("\x07!!!===============================!!!\r\n" + text + "\r\n!!!===============================!!!\r\n", 'SJIS')
                        if ( isCmdMode == false && isNoteMode == false && isSelectMode == false ) {
                            conn.write(encodedText);
                        }
                    }
                }
            });
            // disconnectedなら通知する
            client.on('close', function() {
                console.log('Connection Closed');
                const encodedText = iconv.encode("\x07\r\n!!!>>> WebSocketサーバーから切断されました。Yを押すと再接続します: ", 'SJIS');
                conn.write(encodedText);
                wsDisconnected = true
            });

            client.on('open', async function() {
                console.log('WebSocket Client Connected');
                wsDisconnected = false
                conn.write(iconv.encode("チャンネルに参加しています…", 'SJIS'));
                client.send(JSON.stringify({
                    type: 'connect',
                    body: {
                        channel: channel,
                        id: timeLineChannelUUID,
                        params: {}
                    }
                }));
                conn.write(iconv.encode("\r\nチャンネル " + channel + " に接続しました。", 'SJIS'));
                client.send(JSON.stringify({
                    type: 'connect',
                    body: {
                        channel: "main",
                        id: mainChannelUUID,
                        params: {}
                    }
                }));
                conn.write(iconv.encode("\r\nチャンネル main に接続しました。", 'SJIS'));
                conn.write(iconv.encode("\r\n接続しました。\r\n", 'SJIS'));
                if ( !suppressWelcomeText ) {
                    conn.write(iconv.encode("ユーザー情報を取得しています…\r\n", 'SJIS'))
                    const userinfo = await getUserInfo()
                    const currentDate = new Date()
                    const connectedText = logoforcmd + 
                        "\r\nWELCOME TO TELAMISU! version: " + version + 
                        "\r\nあなたが現在接続しているサーバーは " + server_hostname + " です。\r\n" + 
                        "TELNET(PORT " + telnet_port + ") で接続中です。\r\n" + 
                        "現在時刻は " + currentDate.toLocaleString() + " です。\r\n\r\n" + 
                        "ユーザー名 " + userinfo.name + " (@" + userinfo.userName + ") としてログイン中です。\r\n" + 
                        "フォロワー: " + userinfo.followersCount + 
                        " | フォロー: " + userinfo.followingCount + 
                        " | ノート: " + userinfo.notesCount + 
                        "\r\n\r\nHave fun!\r\n"
                    const encodedConnectedText = iconv.encode(connectedText, 'SJIS')
                    conn.write(encodedConnectedText)
                }
                resolve(true)
            });
        } else {
            reject(false)
        }
    })
}

function disconnectWS() {
    client.send(JSON.stringify({
        type: 'disconnect',
        body: {
            id: timeLineChannelUUID
        }
    }));
    client.close()
}

/*
    コマンド処理等の用意 
*/

function getUserStringFromUserObj(user, altseparator = false) {
    if ( altseparator ) {
        if ( user.host ) {
            return user.name + " - @" + user.username + "@" + user.host
        } else {
            return user.name + " - @" + user.username
        }
    } else {
        if ( user.host ) {
            return user.name + " (@" + user.username + "@" + user.host + ")"
        } else {
            return user.name + " (@" + user.username + ")"
        }
    }
}

function replaceCrlf(str) {
    let input = str ?? ""
    return input.replace(/\n/g, "\r\n")
}

function dispFourNote(conn, offset = 0, showNoteSelectUi = false) {
    appendNoteQueue()
    // ループ数を決めるが、元々4個未満しかノートを取得してない場合はそれに合わせる
    let loopcount = 4
    if ( noteArray.length < 4 ) {
        loopcount = noteArray.length
    }
    const textArray = []
    for (let i = 0; i < loopcount; i++) {
        if ( noteArray[i + offset] ) {
            // SJISにエンコード
            let encodedText = "不明なノート"
            const currentNoteNum = ( noteArray.length - (i + offset) )
            if ( i === 0 && showNoteSelectUi ) {
                encodedText = ">>> ===============================\r\n" + noteObjToDisp(noteArray[i + offset], currentNoteNum) + "\r\n>>> ===============================\r\n"
            } else {
                encodedText = "===============================\r\n" + noteObjToDisp(noteArray[i + offset], currentNoteNum) + "\r\n===============================\r\n"
            }
            // 先頭に置いていき、選択したものは常に一番下に来るようにする
            textArray.unshift(encodedText)
        }
    }
    
    if ( showNoteSelectUi ) {
        textArray.push("ノート選択モード I: ↑ | K: ↓ | L: アクション | Esc: 終了 | " + (noteArray.length - offset) + " / " + noteArray.length + "\r\n")
        conn.write(iconv.encode(" \x1b[2J\x1b[H", 'SJIS'))
    }
    conn.write(iconv.encode(textArray.join(""), 'SJIS'));
} 

function processCmd(data, conn) {
    console.log(data)
    let text = ""
    if ( isConnectionSelect ) {
        if ( data.indexOf("I") !== -1 || data.indexOf("i") !== -1 ){
            selectingServer = selectingServer + 1
        } else if ( data.indexOf("K") !== -1 || data.indexOf("k") !== -1 ){
            selectingServer = selectingServer - 1
        } else if ( data.indexOf("Q") !== -1 || data.indexOf("q") !== -1) {
            text = "\r\nGoodbye!\r\n"
            conn.destroy()
            isNoteMode = false
            isPostFinalCheck = false
            currentWritingNoteArray = []
            isCmdMode = false
            isSelectMode = false
        } else if ( data.indexOf("\u000d") !== -1 ) {
            conn.write(iconv.encode(` \x1b[2J\x1b[H`, 'SJIS'))
            server_select = selectingServer
            if ( servers[server_select] && tokens[servers[server_select]] ) {
                server_hostname = servers[server_select]
                token = tokens[servers[server_select]]
                isConnectionSelect = false
                createWSConnection(conn)
            } else {
                conn.write(iconv.encode(`\r\n接続先が不明です。config.jsonに正しくトークンとサーバーを記述したか確認してください。\r\n`, 'SJIS'))
            }
        }
        if ( selectingServer > servers.length - 1 ) {
            selectingServer = 0
        } else if ( selectingServer < 0 ) {
            selectingServer = servers.length - 1
        }
        if ( data.indexOf("\u000d") === -1 ) {
            const currentDate = new Date();
            let text = " \x1b[2J\x1b[H\r\nWelcome to the Telamisu!\r\n" +
            "TELNET(PORT " + telnet_port + ") で接続中です。\r\n" + 
            "現在時刻は " + currentDate.toLocaleString() + " です。\r\n\r\n接続先のサーバーを選んでください。\r\n";
            conn.write(iconv.encode(text, 'SJIS'))
            for (let i = 0; i < servers.length; i++) {
                if ( selectingServer === i ) {
                    conn.write(iconv.encode(`>>> ${i}: ${servers[i]}\r\n`, 'SJIS'))
                } else {
                    conn.write(iconv.encode(`${i}: ${servers[i]}\r\n`, 'SJIS'))
                }
            }
            conn.write(iconv.encode(`\r\n接続先を選択 I: ↑ | K: ↓ | Enter: 接続 | Q: 切断\r\n`, 'SJIS'))
        }
    } else if ( wsDisconnected == true ) {
        if ( data.indexOf("Y") !== -1 || data.indexOf("y") !== -1 ) {
            conn.write(iconv.encode('\r\n', 'SJIS'))
            createWSConnection(conn, true)
            wsDisconnected = false
        } else {
            conn.write(iconv.encode('\r\nWebSocketサーバーから切断されています。Yを押すと再接続します: ', 'SJIS'))
        }
    } else {
        if ( isNoteMode == true ) {
            if ( isPostFinalCheck == true ) {
                if ( data.indexOf("Y") !== -1 || data.indexOf("y") !== -1 ) {
                    isPostFinalCheck = false
                    isCmdMode = false
                    isNoteMode = false
                    let notebody = JSON.stringify({ "i": token, text: iconv.decode(Buffer.from(currentWritingNoteArray, 'binary'), 'SJIS') })
                    fetch(`https://${server_hostname}/api/notes/create`, { "headers": { "Content-Type": "application/json" }, "method": "POST", "body": notebody }).then(async (data) => {
                        console.log(await data.text())
                    })
                    currentWritingNoteArray = []
                    conn.write(iconv.encode('\r\n', 'SJIS'))
                    text = "\r\nノートは投稿されました。\r\n"
                    dispFourNote(conn)
                } else {
                    isPostFinalCheck = false
                }
            }
            if ( !isPostFinalCheck && isCmdMode == true ) {
                if ( data.indexOf("P") !== -1 || data.indexOf("p") !== -1 ) {
                    text = " \x1b[2J\x1b[H\r\nノートの投稿内容確認: 以下の内容で投稿します。\r\n###---ノートの始まり---###\r\n" + iconv.decode(Buffer.from(currentWritingNoteArray, 'binary'), 'SJIS') + "\r\n###---ノートの終わり---###\r\n\r\n>>> よろしいですか？(Y/N): ", 'SJIS'
                    isPostFinalCheck = true
                } else if ( data.indexOf("Q") !== -1 || data.indexOf("q") !== -1 ) {
                    conn.write(iconv.encode('\r\n', 'SJIS'))
                    text = "\r\nノートの投稿を中止しました。\r\n"
                    isCmdMode = false
                    isNoteMode = false
                    currentWritingNoteArray = []
                    dispFourNote(conn)
                } else {
                    isCmdMode = false
                }
            } else if ( !isPostFinalCheck && isCmdMode == false && isNoteMode == true ) {
                if ( data.indexOf("\u0008") !== -1 ||  data.indexOf("\u007f") !== -1 ) {
                    console.log("backspace or del detected")
                    // SJISの文字コードで書かれたバッファをUTF-8に変換して、一文字削除する
                    const SJISDecodedDelAfter = iconv.decode(Buffer.from(currentWritingNoteArray, 'binary'), 'SJIS').slice(0, -1)
                    // UTF-8に変換して処理したstringを、SJISにエンコードしてバッファに変換する
                    currentWritingNoteArray = Buffer.from(iconv.encode(SJISDecodedDelAfter, 'SJIS')).toJSON().data
                } else if ( data === "\r" ) { 
                    console.log("break detected")
                    currentWritingNoteArray = currentWritingNoteArray.concat([13, 10])
                } else if ( data.indexOf("\u001B") !== -1 ) {
                    text = "\r\n>>> 投稿(P) / 破棄して戻る(Q) \r\nコマンドモードをキャンセルするには Esc を押してください\r\n>>> コマンド: "
                    isCmdMode = true
                } else {
                    currentWritingNoteArray = currentWritingNoteArray.concat(data.toJSON().data)
                    console.log(currentWritingNoteArray)
                    console.log(data.toJSON().data)
                }
                console.log(iconv.decode(Buffer.from(currentWritingNoteArray, 'binary'), 'SJIS'))
                conn.write(iconv.encode(' \x1b[2J\x1b[H', 'SJIS'))
                conn.write(Buffer.from(currentWritingNoteArray, 'binary'))
            }
        } else if ( isSelectMode ) {
            if ( noteActionMode === 1 ){
                if ( data.indexOf("\u000d") !== -1 ) {
                    //console.log("enter")
                    let reactBody = JSON.stringify({ "i": token, reaction: ":" + iconv.decode(Buffer.from(currentReactionArray, 'binary'), 'SJIS') + "@.:", noteId: currentActionNoteObj.id })
                    fetch(`https://${server_hostname}/api/notes/reactions/create`, { "headers": { "Content-Type": "application/json" }, "method": "POST", "body": reactBody }).then(async (data) => {
                        console.log(await data.text())
                    })
                    text = "\r\n" + currentActionNoteObj.id + " に リアクション :" + iconv.decode(Buffer.from(currentReactionArray, 'binary'), 'SJIS') + "@.: を送信しました\r\n" 
                    currentActionNoteObj = {}
                    noteActionMode = 0
                    currentReactionArray = []
                    isCmdMode = false
                    dispFourNote(conn, selectingNoteNum, true)
                } else if ( data.indexOf("\u0008") !== -1 ||  data.indexOf("\u007f") !== -1 ) {
                    //console.log("backspace or del detected")
                    // SJISの文字コードで書かれたバッファをUTF-8に変換して、一文字削除する
                    const SJISDecodedDelAfter = iconv.decode(Buffer.from(currentReactionArray, 'binary'), 'SJIS').slice(0, -1)
                    // UTF-8に変換して処理したstringを、SJISにエンコードしてバッファに変換する
                    currentReactionArray = Buffer.from(iconv.encode(SJISDecodedDelAfter, 'SJIS')).toJSON().data
                } else if ( data.indexOf("\u001B") !== -1 || data == "\u001B" ) {
                    //console.log("quit")
                    noteActionMode = 0
                    currentReactionArray = []
                    isCmdMode = false
                    currentActionNoteObj = {}
                    dispFourNote(conn, selectingNoteNum, true)
                    text = "\r\n中止しました\r\n"
                } else {
                    //console.log("add")
                    currentReactionArray = currentReactionArray.concat(data.toJSON().data)
                }
                console.log(Buffer.from(currentReactionArray, 'binary'))
                if ( data.indexOf("\u000d") === -1 && data.indexOf("\u001B") === -1 && data != "\u001B" ) {
                    conn.write(iconv.encode(" \x1b[2J\x1b[H ===============================\r\n" + noteObjToDisp(currentActionNoteObj, noteArray.length - selectingNoteNum) + "\r\n===============================\r\nノートID " + currentActionNoteObj.id + " にリアクションを送信します(Escキーでキャンセル)\r\n送信するリアクションを入力 >", 'SJIS'))
                    conn.write(Buffer.from(currentReactionArray, 'binary'))
                }
            } else if ( isCmdMode ) {
                if ( data.indexOf("R") !== -1 || data.indexOf("r") !== -1 ){
                    noteActionMode = 1
                    text = " \x1b[2J\x1b[H ===============================\r\n" + noteObjToDisp(currentActionNoteObj, noteArray.length - selectingNoteNum) + "\r\n===============================\r\nノートID " + currentActionNoteObj.id + " にリアクションを送信します(Escキーでキャンセル)\r\n送信するリアクションを入力 >"
                } else {
                    text = "\r\n中止しました\r\n"
                    currentActionNoteObj = {}
                }
            } else {
                if ( data.indexOf("I") !== -1 || data.indexOf("i") !== -1 ){
                    selectingNoteNum = selectingNoteNum + 1
                } else if ( data.indexOf("K") !== -1 || data.indexOf("k") !== -1 ){
                    selectingNoteNum = selectingNoteNum - 1
                } else if ( data.indexOf("L") !== -1 || data.indexOf("l") !== -1 ){
                    isCmdMode = true
                    currentActionNoteObj = JSON.parse(JSON.stringify(noteArray[selectingNoteNum]))
                    text = "\r\nリアクション(R) \r\nコマンドモードをキャンセルするには Esc を押してください\r\n>>> コマンド: \r\n"
                } else if ( data.indexOf("\u001B") !== -1 ) {
                    text = "\r\n選択モードを終了しました。\r\n"
                    isCmdMode = false
                    isSelectMode = false
                    currentWritingNoteArray = []
                    dispFourNote(conn)
                }
                if ( selectingNoteNum > noteArray.length - 1 ) {
                    selectingNoteNum = 0
                } else if ( selectingNoteNum < 0 ) {
                    selectingNoteNum = noteArray.length - 1
                } 
                if ( data.indexOf("\u001B") === -1 ) {
                    dispFourNote(conn, selectingNoteNum, true)
                }
            }

        } else if ( isCmdMode == false ) {
            /* 通常受信中にコマンドモードに移行する */
            if ( data.indexOf("\u001B") !== -1 ) {
                text = ">>> ノート(N) / 選択(S) / 切断して終了(Q) / サーバーから切断(D) \r\nコマンドモードをキャンセルするには Esc を押してください\r\n>>> コマンド: "
                isCmdMode = true
            }
        } else {
            /* 通常受信中のコマンドモードの処理 */
            if ( data.indexOf("\u001B") !== -1 ) {
                text = "\r\n中止しました\r\n"
                isCmdMode = false
            } else if ( data.indexOf("N") !== -1 || data.indexOf("n") !== -1 ) {
                text = "\r\n現在ノート投稿モードです。\r\nEscを押すと、ノートの送信操作や、公開範囲の変更などを行うことができます。\r\n"
                isNoteMode = true
                isCmdMode = false
            } else if ( data.indexOf("Q") !== -1 || data.indexOf("q") !== -1 ) {
                text = "\r\nGoodbye!\r\n"
                disconnectWS()
                conn.destroy()
                isNoteMode = false
                isPostFinalCheck = false
                currentWritingNoteArray = []
                isCmdMode = false
                isSelectMode = false
            } else if ( data.indexOf("D") !== -1 || data.indexOf("d") !== -1 ) {
                text = "\r\nチャンネルとWSから切断します...\r\n"
                disconnectWS()
                isCmdMode = false
            } else if ( data.indexOf("S") !== -1 || data.indexOf("s") !== -1 ) {
                isSelectMode = true
                selectingNoteNum = 0
                isCmdMode = false
                dispFourNote(conn, selectingNoteNum, true)
            } else {
                text = "\r\n不明なコマンドです。中止しました\r\n"
                isCmdMode = false
            }
        }
    }
    
    conn.write(iconv.encode(text, 'SJIS'))
}

/*
    サーバーの用意
*/

let tcpClients = {}

var server = net
.createServer(function (conn) {
    console.log("server-> tcp server created");
    conn.on("data", function (data) {
        processCmd(data, conn)
    });
    conn.on("close", function () {
        console.log("closed connection");
    });
    conn.on("error", console.error);

    const clientId = crypto.randomUUID();
    tcpClients[clientId] = conn;

    isNoteMode = false
    isPostFinalCheck = false
    currentWritingNoteArray = []
    isCmdMode = false
    isSelectMode = false

    const currentDate = new Date();
    if ( bypassselectscreen ) {
        conn.write(iconv.encode("接続しています…", 'SJIS'));
        createWSConnection(conn)
    } else {
        isConnectionSelect = true
        selectingServer = 0
        let text = "\r\nWelcome to the Telamisu!\r\n" +
            "TELNET(PORT " + telnet_port + ") で接続中です。\r\n" + 
            "現在時刻は " + currentDate.toLocaleString() + " です。\r\n\r\n接続先のサーバーを選んでください。\r\n";
        conn.write(iconv.encode(text, 'SJIS'))
        for (let i = 0; i < servers.length; i++) {
            if ( selectingServer === i ) {
                conn.write(iconv.encode(`>>> ${i}: ${servers[i]}\r\n`, 'SJIS'))
            } else {
                conn.write(iconv.encode(`${i}: ${servers[i]}\r\n`, 'SJIS'))
            }
        }
        conn.write(iconv.encode(`\r\n接続先を選択 I: ↑ | K: ↓ | Enter: 接続 | Q: 切断\r\n`, 'SJIS'))
    }
})
.listen(telnet_port);

console.log("telnet server ready on port " + telnet_port);