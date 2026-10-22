# Public source handoff

2026-10-22，`0.1.0-web-m1`，含 R03/R04 格式修正及固定發布流程。

- Source：此公開 repo `KYStr/glossquote-labs-web-media-saver`；目前 commit／branch 可由 `git rev-parse HEAD`／`git branch --show-current` 取得。
- Hosting：由維護者待部署／待驗，不能因 source 公開而當作網站已上線。
- 預定 origin：`https://media.glossquote.com`；Worker：`glossquote-web-media-saver`。
- 正式候選：`node scripts/release.mjs`；發布設定為 assets-only，唯一 custom domain、關閉 workers.dev／preview URLs／metrics／observability／logs／traces，無 Worker 程式及其他資源綁定。
- 正式候選 dist manifest SHA-256：`667c4f23fd7ffe9857742bd1c2223eabf762e723f9acf92d36ff869e6b73be04`；payload fingerprint：`e112bd1b0c85d596998c3e2eebe7d0a6158c9b01a8ec7998bca69ced719a5972`。
- External review：尚未完成。原生選檔／保存／OS下載、Edge與真裝置仍保留實際未驗範圍，不以 protocol 下載替代人工操作。

程式的固定 bytes/SHA 見 [SOURCE-MANIFEST](SOURCE-MANIFEST.json)，驗收範圍見 [PRIMARY-ACCEPTANCE](PRIMARY-ACCEPTANCE.md)。沒有公開內部對話、機器路徑、私有操作規範、憑證、profiles、執行證據目錄或其他產品。

當前僅支援可讀直鏈／本機檔的原檔與短 WAV；平台作品頁及更多編碼尚未實作。[PRODUCT-NEXT](docs/PRODUCT-NEXT.md) 是後續計畫，不是已支援清單。本次未新增代理、引擎或付費服務。
