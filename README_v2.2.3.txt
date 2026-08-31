ギルド対戦管理 v2.2.3 - Gemini無料枠版

【変更点】
- OpenAI APIを廃止
- 東京ディバンカーのスクショ解析を Gemini 2.5 Flash に変更
- GEMINI_API_KEY を Apps Script のスクリプトプロパティから読み込み
- GitHub側にAPIキーは保存しない
- 画像アップロード方式、手修正、ギルド登録・更新、データ管理はv2.2.2を継続

【GitHubへ上書きするファイル】
- index.html
- app.js
- config.js
- style.css

【Apps Script側】
1. Google AI Studio で Gemini APIキーを作成
2. Apps Script → プロジェクトの設定 → スクリプト プロパティ
3. 次を追加
   プロパティ: GEMINI_API_KEY
   値: 発行したGemini APIキー
4. Apps Scriptの現在のAPI.gsの中身を全削除
5. ZIP内の API_v2.2.3.gs の中身を貼り付け
6. 保存
7. デプロイ → デプロイを管理 → 編集 → 新バージョン → デプロイ

【確認】
既存WebアプリURLに ?action=ping を付ける。
次のようになればOK:
  "message":"API v2.2.3 is working"
  "aiConfigured":true

?action=aiStatus では model が gemini-2.5-flash になればOK。

【料金】
この版は Gemini 2.5 Flash のDeveloper API無料枠で動かす前提。
無料枠にはレート/利用量の上限があり、上限時は429エラーになります。
有料課金を有効にしなくても無料枠内で利用できます。

【注意】
無料枠で送信したコンテンツはGoogleの製品改善に使用される場合があります。
ゲーム画面のスクリーンショット用途を想定しています。

【ギルドデータ列】
B=名前, C=属性1, D=戦力1, E=属性2, F=戦力2, G=属性3, H=戦力3
開始行2、200行まで。
