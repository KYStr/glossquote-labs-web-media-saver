# 從保存工具走向可用的影音下載產品

2026-10-22 主代理決策；本文件是後續實作規格與取捨，不是已完成能力。當前發布遵照 WEB-RELEASE，不改已驗證核心。

## 使用者真正要完成的工作

1. 我有一段影片，只想把聲音放進剪輯、簡報或播放器：選影片 → 選 MP3（預設小檔）或 WAV（編輯用途）→ 下載。
2. 我拿到公開影音頁的網址，想保存可下載的版本：貼網址 → 自動辨識來源 → 看清影片/音訊、大小與畫質 → 下載。不要要求使用者找 DevTools、抽直鏈或理解 CORS。
3. 來源不能取得：說清楚此連結目前不能完成的原因，提供來源官方可用的保存路徑或「已取得檔案後轉換」入口；不能把錯誤訊息當成產品完成。

衡量成功應以「能取得並播放內容正確的檔案」為準。不能以支援 URL 正規表示式、格式下拉選單或測試數替代這個結果。

## 本次真正交付與缺口

WEB-M1 已實作直鏈/本機原檔保存、WAV 輸出。主代理補造離線、無個資的 H264/AAC 影片，另驗影片原始 bytes 保存、實際解出非靜音 440 Hz 音軌。測試結果以發布 PRIMARY 記錄為準；本文件不預先宣告通過。

主流平台作品頁解析、MP3/M4A/Opus/FLAC 輸出、長影片、大檔案、播放清單仍是缺口。現行 32 MiB 原檔／16 MiB 與 120 秒轉檔上限只適合短素材，不足以服務一般長影片下載。

## 下一階段優先順序

### P1：影片/音訊 → 好用的本地音檔

原功能對話實作。先做 MP3 與 WAV，不展示無法驗證的格式。輸入沿用來源讀取與失效規則。介面讓人選「較小檔案 MP3」或「後製編輯 WAV」，品質進階可設定；不能要求使用者理解 codec/container。

以固定版本、自行託管的專用編碼器候選作依賴評估，先比較下載資產大小、授權、可中止 worker、最大記憶體及兩語支援。候選可包含專用 LAME WASM；不得直接引入浮動 CDN。依賴任務明確核准與驗證後才整合，無新費用。格式名稱必須與實際編碼、檔頭和可播放輸出吻合。

驗收：至少合成語音式脈衝、單聲道440Hz、雙聲道不同頻率、靜音、缺音軌影片；獨立解碼 MP3/WAV 比較時長、非靜音、頻率與聲道；取消可終止 worker、修改來源立即使舊下載失效；雙語真瀏覽器下載與檔案 bytes 檢查；冷載入只在使用者要求該能力時下載自託管引擎。仍保留無障礙、32/16MiB邊界，任何放寬須量測後定。

### P2：自動解析可公開讀取的平台頁

原功能對話逐站建立 adapter，先以 Wikimedia Commons、指定可讀 PeerTube instance 評估，不冒稱它們等同「各大影音平台」。首站必須用真實公開 API/CORS 回應與固定授權測試素材驗證，再加入支援表。Internet Archive 次順位，先核對 metadata/media CORS 與 redirect。

流程：貼頁網址 → 顯示實際檔名、類型、可取得版本/大小 → 明確按下載後才取影音 → 保存影片或轉音訊。API metadata 讀取也需使用者觸發；不讀 cookie、不留網址日誌。輸出來源與授權連結可供使用者確認。測試不能只 mock API 就標平台支援。

驗收：每平台至少1影片＋1音檔、錯誤網址、已撤下、超限、CORS拒絕、取消、來源更新、無完整檔只有串流；官方API metadata與實際取回bytes一致；失敗不得退到未核准代理或送上使用者資訊。

### P3：主流平台的一鍵體驗 — 必須面對架構決策

YouTube、TikTok、Vimeo、Instagram、Facebook、X、Bilibili 等應各列「取得來源」「聲音」「影片」「畫質」「需要登入」「最近實證日期」；沒有端到端證據就列未支援，不能包成全平台承諾。

主代理推薦評估**網頁入口＋伺服器解析/必要時中轉＋盡可能本地轉檔**，以接近「貼網址就下載」的體驗。單純伺服器回傳 CDN URL 仍可能遇到瀏覽器 CORS、到期、IP 綁定，所以不是完整方案。此架構會使網址、甚至媒體經過伺服器，且引入運算與流量成本；與使用者先前純本地決策不同。在取得這項架構變更授權前，不建立遠端代理、付費主機或上傳媒體。

準備可審核方案應含：首三個平台的可公開下載素材成功率、真實錯誤分類、每次與每月資源估計、費用硬上限/耗盡行為、保留政策、來源網址與媒體最短生命週期、SSRF/私網/redirect/IP檢查、下載大小與時間/並發限制、反濫用、解析器固定版本與更新策略。不要承諾 DRM、會員、登入限制或所有平台/所有版本永久可用。

若維持純本地，持續完成 P1/P2，但明確承認 P3 的主流平台要求未達成。這是產品定位選擇，不應讓使用者從模糊文案中猜測。

## 研究依據（規格須另做真實證實）

- [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)：編解碼之外仍需容器處理，需查實際 codec 能力。
- [專用 MP3 編碼器候選](https://mediabunny.dev/guide/extensions/mp3-encoder)：候選能力不是本產品已整合聲明。
- [FFmpeg WASM 架構](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/apps/website/docs/overview.md)：瀏覽器處理仍有載入與記憶體成本。
- [MediaWiki CORS](https://www.mediawiki.org/wiki/API:Cross-site_requests)、[TimedMediaHandler API](https://www.mediawiki.org/wiki/Extension:TimedMediaHandler/API)。
- [PeerTube API](https://docs.joinpeertube.org/api-rest-reference.html)、[Internet Archive metadata](https://archive.org/developers/md-read.html)。
- [YouTube API policies](https://developers.google.com/youtube/terms/developer-policies)、[Vimeo file links](https://help.vimeo.com/hc/en-us/articles/12427806914577-About-video-file-download-links-from-the-API)、[TikTok query](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query)、[SoundCloud API](https://developers.soundcloud.com/docs/api/guide)。官方 API 資料不等於已驗證可匿名通用下載。
