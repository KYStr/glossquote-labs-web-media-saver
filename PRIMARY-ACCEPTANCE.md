# Scoped primary acceptance

日期：2026-10-22。範圍：WEB-M1 R03/R04 及其固定正式發布流程，非通用平台下載器或任意格式轉檔。

| 已驗項 | 紀錄 |
|---|---|
| 產品離線測試 | 249 PASS，含原139核心測試及WEB-M1/R03/R04回歸。 |
| 獨立測試 | 主驗57 PASS，含串流限制、取消晚回、PCM16與格式誤收案例。 |
| 瀏覽器 | 主驗 Chrome 155 隔離雙語50案例；下載／失效／CORS等依受控測試範圍。 |
| 新發布檢查 | 14離線發布測試PASS，主驗獨立重跑14與check PASS；未改的249／57／50沿用，不重複累加。 |
| 真實合成影片切片 | 主驗另12個雙語案例PASS：H264/AAC合成影片原始bytes相同；取出1秒、48kHz WAV，非靜音且主要頻率約439.5Hz（來源440Hz）。 |

上述合成資料不含人聲／個資，codec結果僅證明所測樣本，不表示所有H264/AAC或所有瀏覽器相容。R03拒絕Matroska標頭外假WebM字串／畸形EBML，R04拒絕不完整ftyp品牌項；仍是基本容器檢查，不是完整demux或安全掃描。

核准程式／config清單為 [SOURCE-MANIFEST](SOURCE-MANIFEST.json)，其SHA-256 `1d1d9d3f83c0c1522047071577f014adea74a0073a6d0a64b4de889e5d622e2c`。正式候選 manifest SHA-256 `667c4f23fd7ffe9857742bd1c2223eabf762e723f9acf92d36ff869e6b73be04`。公開文檔為獨立閱讀整理，沒有擴大產品能力。

仍未驗／尚未完成：原生選檔、保存對話框、OS下載人工流程、Edge／真裝置、外部使用者確認，以及部署後的真實HTTPS、redirect／404、headers和平台級表面設定。Source公開與hosting發布分開，詳見 [HANDOFF](HANDOFF.md)。
