# GlossQuote Web Media Saver

完全網頁、媒體在瀏覽器本地處理。保存瀏覽器能直接讀取的公開 HTTPS 影音直鏈或本機檔案原始 bytes，也可從瀏覽器支援的短片／音檔取出 WAV。使用者不需安裝、解壓或啟動助手。

**正式網站已上線：[繁體中文](https://media.glossquote.com/)／[English](https://media.glossquote.com/en/)。** 2026-10-22 本輪只修正來源的發布 HTML 驗收器（F01），現站仍使用原發布產物，沒有重新部署。F01 修正版已通過主驗、待外部確認；整體外驗維持 partial，未驗範圍見 [主驗紀錄](PRIMARY-ACCEPTANCE.md)。

| 現有功能 | 上限／限制 |
|---|---|
| 保存原檔 | 32 MiB；基本辨識 WAV、MP3、MP4/M4A、WebM、Ogg，不保證完整解碼或安全掃描。 |
| 取出 WAV | 輸入16 MiB、最多120秒；解碼後最多2聲道、48kHz、64MiB Float32 PCM，輸出16-bit PCM WAV。 |
| 來源 | 允許瀏覽器讀取的 HTTPS 媒體直鏈或使用者選取的本機 File；不跟隨 redirect，不附登入憑證。 |
| 尚未提供 | YouTube等平台作品頁擷取、MP3/M4A/Opus/FLAC編碼、HLS/DASH、直播、播放清單、登入或DRM內容。 |

來源仍可看到 IP／請求，CORS、到期或瀏覽器 codec 支援可能使工作失敗。結果「已準備」不代表已保存至磁碟。取消 native 解碼會等待其真正結束才開下一份工作，清除不會刪除已保存檔案。

## 維護者重現

需 Node.js 24+；runtime/dev 外部依賴皆為零，不需套件安裝。

```text
npm test
npm run check
npm run build
npm run serve -- --port=4218
```

一般 build 為 preview/noindex，serve 只綁 loopback、不自動開頁。固定正式候選使用：

```text
node --test test/release.test.mjs
node scripts/release.mjs
```

release 命令只生成並驗證固定 `https://media.glossquote.com` 的 `dist`，不接受 origin／部署參數、不推送、不讀 Token。發布工具鏈要求既有 Wrangler **4.147.0**，不自動下載最新版；部署、正式 HTTPS／routing／headers 驗證由維護者另做。

- [產品範圍](PRODUCT.md)
- [技術與重現說明](docs/TECHNICAL.md)
- [隱私及安全](docs/PRIVACY-SECURITY.md)
- [主驗範圍與 NOT_RUN](PRIMARY-ACCEPTANCE.md)
- [來源與 hosting 交接](HANDOFF.md)
- [後續平台與格式路線：尚未實作](docs/PRODUCT-NEXT.md)
- [35個核准程式／設定檔的 bytes/SHA](SOURCE-MANIFEST.json)

`SOURCE-MANIFEST.json` SHA-256 為 `c7011a55ed499761628236ff4146009c6144fb6d3afb1183f6a758b797d39cc2`。它描述程式／設定，不包含本份公開說明文件；完整版本由 Git commit/tree 固定。
