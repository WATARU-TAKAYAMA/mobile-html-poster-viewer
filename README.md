# Mobile HTML Poster Viewer

iPhone/iPadで、端末に保存したHTMLポスター一式をZIPとして取り込み、ブラウザ内に保存して再閲覧するための静的Webアプリです。

## 使い方

1. SoziやAI生成HTMLポスターのフォルダ一式をZIPにします。
2. このアプリをHTTPS配信されたURLで開きます。
3. `ZIP追加` からZIPを選択します。
4. 一覧に保存されたポスターの `開く` を押します。
5. 表示が重い場合はビューア上部の `直接表示` を押します。

取り込んだデータはIndexedDBに保存されます。Safariのサイトデータを削除すると、保存済みポスターも削除されます。

## 配置

このフォルダをそのままGitHub Pagesなどの静的ホスティングに置けます。Service Workerを使うため、通常はHTTPS配信が必要です。`localhost` ではHTTPでも動作します。

## 対応形式

- ZIP内のHTML、CSS、JavaScript、画像、SVG、フォントなど
- iOS/iPadOSの「ファイル」アプリで圧縮したZIP
- ZIP内の `index.html` を優先して起動
- `index.html` がない場合、HTML候補から選択
- HTMLの文字コード指定を尊重するため、Shift_JIS/CP932系の古いHTMLでも表示できる場合があります

## 注意

取り込むHTMLのJavaScript実行を許可します。自分で作成した、または信頼できるHTMLだけを取り込んでください。

大きなSoziファイルや画像が多いZIPは、iPhone/iPadでは取り込みや表示に時間がかかることがあります。表示が重い場合は、画像サイズを下げたZIPを作るか、ビューアの `直接表示` を使ってください。
