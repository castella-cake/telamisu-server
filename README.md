# Telamisu
Telamisuは、Node.jsとwsモジュールを使用して開発されている、Misskeyのクライアントとして動作するTelnetサーバーです。   
古いシステムでもモダンPCにこのサーバーをセットアップすることで、   
好きなインスタンスのタイムラインを閲覧したり、ノートの投稿ができるようになります。   

アクセストークンも全てサーバー上にあるものを使用するため、   
クライアントと取り交わすデータはクライアントの操作と投稿などの入力、そしてサーバーからの受信内容のみで済みます。

**重要: このTelnetサーバーを決して外部に公開しないでください。**   
このプロジェクトは娯楽的用途に限って開発されています。   
サーバーはLAN内に限って公開されることを想定しており、一切の認証機能を持ちません。   
これは、このTelnetサーバーに接続できる人が誰でも**あなたのアカウントを使用してノートの投稿やタイムラインを閲覧することができるようになる**ことを意味します。   

また、開発者はこのプロジェクトを使用した事による損害に対して一切の責任を負いません。   

**UNDER CONSTRUCTION**   
このプロジェクトはまだ開発段階にあるため、未完成の機能や予期していないバグに遭遇することがあります。   
問題を見つけたときは気軽にIssueを立ててください。   
バグ報告の際は、使っているクライアントや接続先などの情報提供があると助かります。

# Quick start
`config_sample.json`を`config.json`としてコピーしたら、`servers` に接続するMisskeyサーバーのホスト名を記述します。配列型なので複数記述できます。   

`tokens` には接続するMisskeyサーバーのアクセストークンを記述します。   
オブジェクト型で、`"ホスト名": "トークン"` のペアをserversの数だけ記述する必要があります。(`,`で区切ります)   
使用するトークンには少なくとも以下の権限を付与しておくことをおすすめします。(トークンは厳重に保護してください)   
- アカウントの情報を見る
- ノートを作成・削除する

`bypassselectscreen` を `true`に設定すると、`servers`の最初に記述したサーバーに自動で接続します。   
接続先のサーバーを一つのみ記述した場合は、選択画面をスキップできるので`true`に設定しておくことをおすすめします。   

`channel` には接続するタイムラインを指定します。   
Misskey Hubの[チャンネル一覧](https://misskey-hub.net/docs/api/streaming/channel/)を参考に接続したいタイムラインのチャンネル名を入力します。   
(`main` はデフォルトで接続するため記述しないでください)   

Configの記述を終えたら、`npm i` で依存関係をインストールして、
`npm run start`でサーバーを起動します。   
`telnet server ready on port23` が表示されたら、サーバーの起動は完了です。

# Connect
接続するクライアントは必ず送信/受信の文字コードを`Shift_JIS` に合わせておく必要があります。   
古いシステムの互換性を維持するために送信にUTF-8を使用していません。サーバー側もShift_JISであるものとしてデータを受け取ります。   
それ以外の文字コードを使用した場合、正常にノートが送信できなかったり、操作できないなどの問題が発生する可能性があります。   

それ以外にも、以下の設定を行っておくことをおすすめします:
- ローカルエコー(Enterを押して手動送信するクライアントの場合)
- エミュレーション: `VT100` もしくは `VT100J` (ターミナルの場合)

以下はシステムの接続ガイドです。   
(レトロシステムに関しては現状開発者が機材を持っていないため、あまり当てにしないでください)

## モダンシステムやLANアクセスのあるレトロシステムの場合
Tera TermやWindows標準のTelnetクライアントから接続します。   
ファイアウォールなどを正しく設定していれば、`telnet <TelamisuへのIP>`などで接続できるはずです。   

## シリアルポートのあるレトロシステムの場合
ネットワークのサポートを持っていないモデムが必要なレトロPCでも、以下のセットアップがあればTelamisuに接続できます。   

### 必要なもの
- モダンなLinuxが動くシリアルポートを持ったPC 1台(TelamisuをそのPCで実行してもOKです)
- シリアルポートのあるレトロPC 1台
- シリアルケーブル 1個

### tcpserをセットアップする
モデムをエミュレートして特定の電話番号をTelamisuのIPに接続するために、モダンPCでtcpserを使用します。   
モダンPCで https://github.com/FozzTexx/tcpser をダウンロードして `make` などでビルドします。   

ビルドしたら、`sudo ./tcpser -d /dev/<シリアルポート> -s <ボーレート> -n 1=<TelamisuへのIP>:23` のコマンドでtcpserを実行します。   
`<シリアルポート>`はレトロPCと接続するシリアルポート(COM0なら`ttyS0`)に、`ボーレート`は接続速度(9600や38400など)に、   
`<TelamisuへのIP>`はTelamisuを実行しているコンピューターのIP(同じPCで実行しているなら`127.0.0.1`)   
に置き換えてください。今回は電話番号 `1`にダイヤルすると、Telamisuに接続するようにしています。   

モダンPCとレトロPCをシリアルケーブルで接続したら、レトロPCでモデムをセットアップします。   
そうしたら、ハイパーターミナルやTelemateなどで`1`にダイヤルして、   
接続できれば、Telamisuへの接続は完了です。
(市外局番や国番号などは使用しないようにしてください)

# How to use
## サーバー選択
Telnetサーバーに接続すると、最初に接続先サーバーを選ぶための画面が表示されます。   
Iキー,Kキーで選択を移動し、Enterキーで選択したサーバーに接続します。   
選択画面をスキップする設定にした場合は、この画面はスキップされます。   

サーバーに接続すると、最初にログインしているアカウントの名前やフォロワー/フォロー数、ノート数が表示されます。
## メッセージ受信モード
初期状態はメッセージ受信モードです。configで設定したタイムラインの新着ノートと、新着通知がある場合に内容を送信します。   
Escを押すとコマンド入力モードに移行します。メッセージ受信モード以外の間は、新しい内容を受信しても表示されません。   
(その後受信モードに戻っても、その間に受信した内容は表示されないため、注意してください)   

メッセージ受信モード時のコマンドは以下の通りです。
- ノート( create **N**ew **N**ote ) - Nキー
- 選択( **S**elect ) - Sキー
- 切断して終了 ( disconnect and **Q**uit ) - Qキー
- コマンド入力モードをキャンセル - Escキー
## ノート投稿モード
ノートコマンドを送信するとノート投稿モードに移動します。   
ノート投稿モードでは文字の入力や改行操作に対応しています。Escキーを押すとコマンド入力モードに移行します。   
(矢印キーなどは使用できないので、快適な入力が必要な場合はメモ帳などからペーストする必要があります)   

ノート投稿モード時のコマンドは以下の通りです。
- 投稿( **P**ost ) - Pキー
- 破棄して戻る ( discard and **Q**uit ) - Qキー
- コマンド入力モードをキャンセル - Escキー

投稿コマンドを入力すると投稿前の最終確認が表示されます。   
承諾するとノートが投稿されメッセージ受信モードに戻ります。
## ノート選択モード
選択コマンドを送信するとノート選択モードに移動します。   
ノート選択モードでは、このセッションで受信したノートを見ることができます。   

ノート選択モードでは以下の操作ができます。
- 上へ移動 - Iキー
- 下へ移動 - Kキー
- ノート選択モードを終了 - Escキー
## WebSocketからの切断
Misskeyは稀にWebSocketを切断することがあります。   
切断されると、画面に切断されたことが通知され、ユーザーからの再接続の承認を待ちます。
(その間は、ノート投稿モードやコマンド入力モードへの入力ができなくなります)