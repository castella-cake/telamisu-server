const WebSocket = require('ws');
const net = require("net");
const crypto = require("crypto");
const iconv = require("iconv-lite");
const version = "v0.1.0";
const { server_hostname, token, telnet_port, channel } = require("./config.json");

const logo = `  __  __ ___ ___ ___ _____ ___ _    _  _ ___ _____ 
|  \\/  |_ _/ __/ __|_   _| __| |  | \\| | __|_   _|
| |\\/| || |\\__ \\__ \\ | | | _|| |__| .' | _|  | |  
|_|  |_|___|___/___/ |_| |___|____|_|\\_|___| |_|  `

const logoforcmd = logo.replace(/\n/g, "\r\n")

// 接続時のウェルカムメッセージ用に自身の情報を写す
let infoFetchbody = JSON.stringify({ "i": token })


function getUserInfo() {
    return new Promise((resolve,reject) => {
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
    if ( note.text && note.renoteId && note.renote ) {
        // テキストもある、リノートIDもある(引用リノート)
        text = getUserStringFromUserObj(note.user) + " が引用リノートしました: \r\n" + 
            replaceCrlf(note.text) + "\r\nRN(" + getUserStringFromUserObj(note.renote.user, true) + "): " + replaceCrlf(note.renote.text);
        return { type: "quote", id: note.id, createdAt: note.createdAt, user: {name: note.user.name, username: note.user.username, host: note.user.host}, text: note.text, renote: createNoteObj(note.renote) }
    } else if ( note.text ) {
        // テキストがある(ノート)
        return { type: "quote", id: note.id, createdAt: note.createdAt, user: {name: note.user.name, username: note.user.username, host: note.user.host}, text: note.text }
    } else if ( note.renoteId && note.renote ) {
        // テキストはないけどリノートIDがある、リノートのノートもある(リノート)
        return null
    } else if ( note.renoteId ) {
        return null
    }
    return
}

function addToNoteArray(noteobj) {
    if ( noteobj ) {
        noteArray.push(noteobj)
    } else {
        return false 
    }
}

/*  
    websocket,コマンドの変数用意
*/
let client

let timeLineChannelUUID = crypto.randomUUID()
let mainChannelUUID = crypto.randomUUID()

let isCmdMode = false
let isNoteMode = false
let isPostFinalCheck = false
let noteText = ""
let wsDisconnected = false
let noteArray = []

function createWSConnection(conn) {
    return new Promise((resolve, reject) => {
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
            if ( msgObj.type == "channel" && isCmdMode == false && isNoteMode == false ) {
                if ( msgBody.type == "note" ) {
                    let text = "不明なノート"
                    const createdDate = new Date(msgBody.body.createdAt)
                    if ( msgBody.body.text && msgBody.body.renoteId && msgBody.body.renote.text ) {
                        // テキストもある、リノートIDもある(引用リノート)
                        text = getUserStringFromUserObj(msgBody.body.user) + " が引用リノートしました: \r\n" + 
                            replaceCrlf(msgBody.body.text) + "\r\nRN(" + getUserStringFromUserObj(msgBody.body.renote.user, true) + "): " + replaceCrlf(msgBody.body.renote.text) +
                            "\r\n" + createdDate.toLocaleString('ja-JP') + " / " + ( noteArray.length + 1 )
                    } else if ( msgBody.body.text ) {
                        // テキストがある(ノート)
                        text = getUserStringFromUserObj(msgBody.body.user) + " がノートしました: \r\n" + 
                            replaceCrlf(msgBody.body.text) +
                            "\r\n" + createdDate.toLocaleString('ja-JP') + " / " + ( noteArray.length + 1 );
                    } else if ( msgBody.body.renoteId && msgBody.body.renote.text ) {
                        // テキストはないけどリノートIDがある、リノートのノートのテキストもある(リノート)
                        text = getUserStringFromUserObj(msgBody.body.user) + " がリノートしました: " + 
                            "\r\nRN(" + getUserStringFromUserObj(msgBody.body.renote.user, true) + "): " + replaceCrlf(msgBody.body.renote.text) +
                            "\r\n" + createdDate.toLocaleString('ja-JP');
                    } else if ( msgBody.body.renoteId ) {
                        // テキストはないけどリノートIDがある(リノート)
                        text = getUserStringFromUserObj(msgBody.body.user) + " がリノートしました: \r\nRN: " + 
                            msgBody.body.renoteId +
                            "\r\n" + createdDate.toLocaleString('ja-JP');
                    }
                    addToNoteArray(createNoteObj(msgBody.body))
                    // SJISにエンコード
                    const encodedText = iconv.encode("===============================\r\n" + text + "\r\n===============================\r\n", 'SJIS')
                    // 送信
                    conn.write(encodedText);
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
                    conn.write(encodedText);
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

        client.on('open', function() {
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
            client.send(JSON.stringify({
                type: 'connect',
                body: {
                    channel: "main",
                    id: mainChannelUUID,
                    params: {}
                }
            }));
            conn.write(iconv.encode("接続しました。\r\n", 'SJIS'));
            resolve(true)
        });
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

function processCmd(data, conn) {
    console.log(data)
    let text = ""
    if ( wsDisconnected == true ) {
        if ( data.indexOf("Y") !== -1 || data.indexOf("y") !== -1 ) {
            conn.write(iconv.encode('\r\n', 'SJIS'))
            createWSConnection(conn)
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
                    let notebody = JSON.stringify({ "i": token, text: noteText })
                    fetch(`https://${server_hostname}/api/notes/create`, { "headers": { "Content-Type": "application/json" }, "method": "POST", "body": notebody }).then(async (data) => {
                        console.log(await data.text())
                    })
                    noteText = ""
                } else {
                    isPostFinalCheck = false
                }
            }
            if ( !isPostFinalCheck && isCmdMode == true ) {
                if ( data.indexOf("P") !== -1 || data.indexOf("p") !== -1 ) {
                    text = "\x1Bc\r\nノートの投稿内容確認: 以下の内容で投稿します。\r\n###---ノートの始まり---###\r\n" + noteText + "\r\n###---ノートの終わり---###\r\n\r\n>>> よろしいですか？(Y/N): ", 'SJIS'
                    isPostFinalCheck = true
                } else if ( data.indexOf("Q") !== -1 || data.indexOf("q") !== -1 ) {
                    text = "\r\nノートの投稿を中止しました。"
                    isCmdMode = false
                    isNoteMode = false
                    noteText = ""
                } else {
                    isCmdMode = false
                }
            } else if ( !isPostFinalCheck && isCmdMode == false && isNoteMode == true ) {
                if ( data.indexOf("\u0008") !== -1 ) {
                    noteText = noteText.slice(0, -1)
                } else if ( data.indexOf("\u001B") !== -1 ){
                    text = "\r\n>>> 投稿(P) / 破棄して戻る(Q) \r\nコマンドモードをキャンセルするには Esc を押してください\r\n>>> コマンド: "
                    isCmdMode = true
                } else {
                    noteText = noteText + iconv.decode(Buffer.from(data, 'binary'), 'SJIS')
                }
                conn.write(iconv.encode('\x1Bc', 'SJIS'))
                conn.write(iconv.encode(noteText, 'SJIS'))
            }
        } else if ( isCmdMode == false ) {
            /* 通常受信中にコマンドモードに移行する */
            if ( data.indexOf("\u001B") !== -1 ) {
                text = ">>> ノート(N) / 切断して終了(Q) / サーバーから切断(D) \r\nコマンドモードをキャンセルするには Esc を押してください\r\n>>> コマンド: "
                isCmdMode = true
            }
        } else {
            /* 通常受信中のコマンドモードの処理 */
            if ( data.indexOf("\u001B") !== -1 ) {
                text = "\r\n中止しました\r\n"
                isCmdMode = false
            } else if ( data.indexOf("N") !== -1 || data.indexOf("n") !== -1 ) {
                text = "\r\nWIP\r\n現在ノート投稿モードです。\r\nEscを押すと、ノートの送信操作や、公開範囲の変更などを行うことができます。\r\n"
                isNoteMode = true
                isCmdMode = false
            } else if ( data.indexOf("Q") !== -1 || data.indexOf("q") !== -1 ) {
                text = "\r\nGoodbye!\r\n"
                disconnectWS()
                conn.destroy()
                isNoteMode = false
                isPostFinalCheck = false
                noteText = ""
                isCmdMode = false
            } else if ( data.indexOf("D") !== -1 || data.indexOf("d") !== -1 ) {
                text = "\r\nチャンネルとWSから切断します...\r\n"
                disconnectWS()
                isCmdMode = false
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

    conn.write(iconv.encode("接続しています…", 'SJIS'));
    createWSConnection(conn).then(async (res) => {
        if ( res ) {
            const userinfo = await getUserInfo()
            const connectedText = logoforcmd + 
                "\r\nWELCOME TO MISSTELNET! version: " + version + 
                "\r\nあなたが現在接続しているサーバーは " + server_hostname + " です。\r\n" + 
                "TELNET(PORT " + telnet_port + ") で接続中です。\r\n\r\n"+ 
                "ユーザー名 " + userinfo.name + " (@" + userinfo.userName + ") としてログイン中です。\r\n" + 
                "フォロワー: " + userinfo.followersCount + 
                " | フォロー: " + userinfo.followingCount + 
                " | ノート: " + userinfo.notesCount + 
                "\r\n\r\n それでは、お楽しみください！\r\n" + 
                "チャンネル " + channel + " に接続されています。\r\n"
            const encodedConnectedText = iconv.encode(connectedText, 'SJIS')
            conn.write(encodedConnectedText)
        }
    })


})
.listen(telnet_port);

console.log("telnet server ready on port" + telnet_port);