# Scoped primary acceptance

日期：2026-10-22。範圍：WEB-M1 R03/R04、固定正式發布流程及 F01 發布 HTML 驗收器修正。不是通用平台下載器或任意格式轉檔。

以下保留原發布階段的主驗證據，並非本輪新增或外部執行數。

| 原發布已驗項 | 紀錄 |
|---|---|
| 產品離線測試 | 249 PASS，含原139核心測試及WEB-M1/R03/R04回歸。 |
| 獨立測試 | 主驗57 PASS，含串流限制、取消晚回、PCM16與格式誤收案例。 |
| 瀏覽器 | 主驗 Chrome 155 隔離雙語50案例；下載／失效／CORS等依受控測試範圍。 |
| 原發布檢查 | 14離線發布測試PASS，主驗重跑14與check PASS；與當時249／57／50不重複累加。 |
| 真實合成影片切片 | 主驗另12個雙語案例PASS：H264/AAC合成影片原始bytes相同；取出1秒、48kHz WAV，非靜音且主要頻率約439.5Hz（來源440Hz）。 |

上述合成資料不含人聲／個資，codec結果僅證明所測樣本，不表示所有H264/AAC或所有瀏覽器相容。R03拒絕Matroska標頭外假WebM字串／畸形EBML，R04拒絕不完整ftyp品牌項；仍是基本容器檢查，不是完整demux或安全掃描。

## 本輪 F01 修正與主驗

外部複核確認原驗收器可誤收重算 manifest 後的額外 head 標籤；沒有證據表示正式網站已遭修改或不能收錄。修正版以核准來源及僅兩項正式 SEO 替換重建完整 HTML，逐 bytes 比對整份輸出。

| 本輪已驗項 | 結果與邊界 |
|---|---|
| 實際 Node 24.14.0 | 原開發與主驗各自完整279 PASS／0 fail／0 skipped；包含原263及新增16例，兩次執行不相加。 |
| check／release | 雙方皆 exit 0；Node版本門檻保留，零外部依賴。 |
| 新增16個正式回歸 | 中英文各8類 head 變異；先確認變異生效、body不變、manifest重算自洽，再要求具體 RELEASE_HTML_CHANGED 拒絕。 |
| 主驗獨立16反例 | 修正前16誤收，修正後16指定錯誤拒絕；原產物在兩版皆通過。未向正式站注入變異。 |
| 來源／產物 | 35份程式／設定只變release與其測試，其餘33份不變；16份dist（含manifest）逐bytes不變。 |
| 正式HTTP／SEO | 重新取得15份公開媒體檔案，bytes與舊發布相同，必要安全headers與兩語robots/canonical/hreflang等符合；雙語首頁回應與原發布及既有入口契約相符。非browser互動。 |

首頁初次檢查器誤將 slash URL 視為最終路徑，出現2個 redirect 斷言失敗；主驗查核既有 index.html 路徑／canonical 契約後，以同一批完整回應複核通過。保留原失敗紀錄，沒有為此修改首頁、增加請求數或宣稱產品修正。

外部報告的97個新增元件包含48組PCM；18份媒體成品是既有輸出複核，非本輪新browser下載／轉檔。這些不與本輪Node279或其他歷史案例相加。外部原Node22 runner紀錄保留其版本限制及未明原因失敗，不回寫成Node24結果。

核准程式／config清單為 [SOURCE-MANIFEST](SOURCE-MANIFEST.json)，其SHA-256 `c7011a55ed499761628236ff4146009c6144fb6d3afb1183f6a758b797d39cc2`。原部署來源commit `8716a264c6d6866d2343a0b7ec7b2a163dc797c7`、正式manifest SHA-256 `667c4f23fd7ffe9857742bd1c2223eabf762e723f9acf92d36ff869e6b73be04` 均保留；本輪來源驗收器更新沒有重新部署或改首頁。

**整體外驗仍為 PARTIAL；F01 修正主驗通過，待外部確認修正版。** 完整獨立browser E2E、真實跨來源CORS成功／失敗矩陣、完整Network/Storage生命週期、原生選檔／保存／OS下載人工流程、Edge／真機／讀屏仍NOT_RUN。HTTP標頭觀測與單一儲存快照不能代替這些驗收，也沒有宣告全產品complete。

來源公開與現站部署版本分開記錄，詳見 [HANDOFF](HANDOFF.md)。
