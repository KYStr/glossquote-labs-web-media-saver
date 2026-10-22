# Privacy and security boundaries

媒體不傳到GlossQuote處理服務。本機File留在瀏覽器；直鏈模式由瀏覽器直接GET使用者指定的來源，來源仍可看見IP與請求，因此不宣稱完全離線。

不讀帳號cookies、browser profiles、剪貼簿、登入憑證或引擎config；無媒體代理、遠端播放器／縮圖、telemetry、beacon、Service Worker或持久browser storage。網址只用於目前工作，不放進站內URL或診斷。錯誤是固定code與雙語說明，不含原URL／query／exception／檔名。

只在明確開始或示範按鈕後取媒體。禁止userinfo、非預設port、IP與localhost／保留名稱；前端不宣稱能驗證DNS防重綁。CORS／到期／網路／redirect可能使來源不可讀，不使用no-cors、隱藏代理或本機服務回退。

讀取實際bytes受限；部分檔、HTML／JSON／播放清單及不符類型拒絕。基本容器辨識不是完整解碼或安全掃描。取消／失敗清除自己的partial與下載結果；保存後的使用者成果不因clear被刪除。異常關頁、瀏覽器／OS快取與native decoder記憶體回收不作全清保證。

部署headers採default-src none、script/style self、connect-src self https:、media-src blob:、base/form/object/frame-ancestors none，並設no-referrer／nosniff／禁iframe。HTTPS connect只供明確來源請求；真實HTTPheaders與網路行為仍須依部署及主驗範圍核對，不以設定檔當作live驗證。
