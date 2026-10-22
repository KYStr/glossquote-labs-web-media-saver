# Product scope

使用者的工作是把自己有權取得的短影音保存成可用檔案；介面為「直鏈或本機檔案 → 原檔或WAV → 開始 → 下載」。處理在瀏覽器內完成，不需安裝助手。

原檔上限32MiB；取WAV的輸入上限16MiB與120秒。原檔保持bytes，依基本容器簽章與MIME一致性產生安全副檔名。WAV採瀏覽器可支援的解碼、最多2聲道／48kHz／64MiB解碼PCM，再輸出正確交錯的16-bit little-endian PCM。不能解碼、來源不允許CORS或超限會清楚失敗，不改副檔名冒充轉檔。

只有公開HTTPS的直接媒體URL及本機File；來源下載不附credentials，不跟隨redirect。平台作品頁、登入／DRM／付費／私密內容、直播／播放清單、MP3等其他編碼皆不是當前能力。

一次一份工作。取消／來源或模式修改使舊結果失效；native解碼無可靠abort，必須等待settle才允許下一份。完成的object URL在結果有效期間保留供再次下載；clear／離開釋放本頁參照，不刪已保存影音、不宣稱即時RAM回收。

下一階段的具體需求及尚未實作路線見 [PRODUCT-NEXT](docs/PRODUCT-NEXT.md)，實際主驗與未驗範圍見 [PRIMARY-ACCEPTANCE](PRIMARY-ACCEPTANCE.md)。
