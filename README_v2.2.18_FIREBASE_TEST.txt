ギルド対戦管理 v2.2.18 Firebase点呼リアルタイム同期テスト版

【変更点】
- v2.2.17の全機能を維持
- 「メンバー」画面の点呼だけを Cloud Firestore でリアルタイム同期
- PCで点呼を変更すると、同じモードのスマホへ即時反映
- 点呼は従来どおり Apps Script + Googleスプレッドシートにも保存
- Firebase失敗時も従来方式は継続

【GitHub側】
ZIP内のWebファイルをすべて上書きしてください。index.htmlも必ず更新します。

【Apps Script側】
変更はありません。v2.2.17をそのまま使えます。API_v2.2.18.gsは同じ内容です。

【Firestoreの点呼データ】
attendance コレクションに normal_6 などのドキュメントを作成します。
mode / row / checked / updatedAt を保存します。

【確認方法】
1. PCとスマホで同じページ、同じモードを開く
2. PCでメンバーの点呼をON/OFF
3. スマホ側にほぼ即時反映されることを確認
4. Firestoreが使えない場合でも、従来の数秒同期で反映されることを確認

【重要】
現在のFirestoreルールは2026年10月2日に失効するテスト用です。本運用前に認証とSecurity Rulesの制限が必要です。
