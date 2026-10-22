# Public source handoff

2026-10-22，產品版本 `0.1.0-web-m1`；來源包含 R03/R04 格式修正、固定發布流程及 F01 完整 HTML 驗收器修正。

- Source：此公開 repo `KYStr/glossquote-labs-web-media-saver`；目前來源 commit／branch 可由 `git rev-parse HEAD`／`git branch --show-current` 取得。
- Hosting：正式網站已上線：[繁體中文](https://media.glossquote.com/)／[English](https://media.glossquote.com/en/)。雙語首頁已有入口：[繁中首頁](https://glossquote.com/)／[英文首頁](https://glossquote.com/en/)。
- 現站部署來源：[8716a264c6d6866d2343a0b7ec7b2a163dc797c7](https://github.com/KYStr/glossquote-labs-web-media-saver/commit/8716a264c6d6866d2343a0b7ec7b2a163dc797c7)。本輪更新來源驗收器與回歸測試，正式前端 assets／HTML／robots／sitemap／安全 headers 的產物 bytes 全部不變，沒有新增 deploy。
- 正式 origin：`https://media.glossquote.com`；Worker：`glossquote-web-media-saver`。`node scripts/release.mjs` 只產生並驗證固定正式產物，不執行部署。
- 發布設定為 assets-only、唯一 custom domain；workers.dev／preview URLs／metrics／observability／logs／traces 關閉，無 Worker 程式及其他資源綁定。
- 正式 dist manifest SHA-256：`667c4f23fd7ffe9857742bd1c2223eabf762e723f9acf92d36ff869e6b73be04`；payload fingerprint：`e112bd1b0c85d596998c3e2eebe7d0a6158c9b01a8ec7998bca69ced719a5972`，兩者沿用原部署。

F01 原因是驗收器只核對部分 head 與完整 body，重算 manifest 後可能誤收未核准的額外 head 標籤。現在用核准 public HTML 加上僅兩項正式 SEO 替換重建完整預期結果，以 bytes 比對整份 HTML；既有設定、資產、manifest 與安全 headers 檢查保留。此修正不是已發現正式站被竄改或停止收錄的證據。

原開發與主驗各自使用實際 Node 24.14.0 完整重跑279項（263既有＋16新增），0 fail／0 skipped；check／release 均 exit 0。主驗另自行驗證16個雙語 head 反例，原版誤收、修正版全部因指定 HTML 錯誤拒絕，原正式產物仍通過。兩次279及獨立16不相加成獨特案例總數。

主驗本輪重新取得15份正式公開媒體檔案，bytes 與原發布相同，必要安全 headers 及兩語 SEO 符合；雙語首頁的完整回應也符合既有 index.html 路徑與同語言入口。這是 HTTP 複核，沒有新 browser 操作，也不能代替完整 Network／Storage 生命週期驗收。

**External review：PARTIAL。F01 修正已通過主驗，尚待外部確認修正版。** 外部元件／既有成品複核只支持其限定範圍；完整獨立 browser E2E、跨來源 CORS 真實情境、Network／Storage 全生命週期、原生選檔／另存／OS下載、Edge、真機、讀屏仍 NOT_RUN，不以 protocol 下載替代人工操作。

| 來源核對 | SHA-256 |
|---|---|
| scripts/release.mjs（6,613 bytes） | `ec7124f04a632f45e6cd220c448a7c127464c901ea932bf652dc22aac13b22ab` |
| test/release.test.mjs（12,841 bytes） | `7e5fb43909b622c52444508a3ce1a180cebfc51ba3cfcfe9e3fe2b2c723468f9` |
| SOURCE-MANIFEST.json（35份程式／設定） | `c7011a55ed499761628236ff4146009c6144fb6d3afb1183f6a758b797d39cc2` |

完整程式 bytes／SHA 見 [SOURCE-MANIFEST](SOURCE-MANIFEST.json)，驗收範圍見 [PRIMARY-ACCEPTANCE](PRIMARY-ACCEPTANCE.md)。公開版本由 Git commit/tree 固定，不包含內部對話、機器路徑、私有操作規範、憑證、profiles、執行證據目錄或其他產品。

當前僅支援可讀直鏈／本機檔的原檔與短 WAV；平台作品頁及更多編碼尚未實作。[PRODUCT-NEXT](docs/PRODUCT-NEXT.md) 是後續計畫，不是已支援清單。本次未新增代理、引擎或付費服務。
