# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.2.0 - 2023/10/

### Added
- 接続先を複数記述し、接続時に接続先インスタンスを選択できるようになりました

### Changed
- config.jsonの`server_hostname`と`token`は廃止され、`servers`と`tokens`が使用されるようになりました   
(これにより、過去のconfig.jsonは動作しなくなります)
- 画面クリアのエスケープシーケンスは`\x1b[2J\x1b[H`を使用するようになりました

### Fixed
- 1バイトずつ入力を送信するクライアントで、ノート投稿が文字化けする問題を修正しました

## 0.1.0 - 2023/10/09

### Added
- Telnetサーバーとして動作できるようになりました
- Misskeyへの接続機能を追加
- タイムライン閲覧機能を追加
- ノート投稿機能を追加
- 未読通知受信機能を追加
- 受信ノート選択機能を追加
- 切断操作などを追加