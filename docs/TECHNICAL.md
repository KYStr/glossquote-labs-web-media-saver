# Technical and reproduction notes

Node.js 24+只用於維護者測試與靜態建置。瀏覽器應用在 `public/assets/`，無Node API、外部runtime/dev依賴、Service Worker或遙測。`src/core/`是保留的歷史M0核心及離線測試，不直接接到新UI。

## 媒體管線

- `source.mjs`：HTTPS／公共DNS名稱語法、早期作品頁拒絕；固定GET/CORS、credentials omit、no-referrer、no-store、redirect error。只收HTTP200，依每塊實際累計bytes上限，總120秒／無資料20秒timeout，取消等待reader收尾。
- `media.mjs`：有限WAV／MP3／MP4/M4A／WebM／Ogg基本容器與MIME檢查。MP3須完整LayerIII frame；WebM須有界EBML Header內唯一真正DocType；MP4不接受QuickTime／AVIF／HEIC及未對齊ftyp。
- `audio.mjs`／`wav.mjs`：先以Blob metadata確認≤120秒，才解碼；解碼後重新驗證聲道、frames、rate與PCM量。分塊編碼可取消。native decoder不是硬記憶體隔離，不能可靠abort。
- `job.mjs`：單工作、固定錯誤、取消等待、晚回無效、結果object URL所有權。URL／File／模式變更、clear和pagehide都使舊結果失效。

## 建置

`npm run build`預設preview/noindex。`node scripts/release.mjs`才固定 `https://media.glossquote.com` 的正式candidate，檢查雙語canonical／hreflang／x-default、robots/sitemap、headers與閉合bytes/SHA manifest。它不部署、不讀Token、不接受origin override。

`wrangler.jsonc`是assets-only，唯一custom domain為 `media.glossquote.com`，`html_handling:auto-trailing-slash`／`not_found_handling:none`，沒有Worker entrypoint或資源綁定。發布使用維護者已核准Wrangler4.147.0，repo不自動安裝CLI。雲端實際routing／404／headers仍須部署後驗證。

根 `SOURCE-MANIFEST.json`固定35個程式／config檔案的bytes與SHA，不包含公開整理文檔本身。所有建置都拒絕未知產物、symlink／junction與path escape。測試只使用合成媒體及自有loopback測試服務，沒有真平台請求；開發預覽不自動開瀏覽器。
