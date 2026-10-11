# 貴賓室智能行程｜互動原型

以兩張參考設計圖為基礎製作的手機介面，包含「自主安排行程」和「智能助手對話」兩個畫面。

## 啟用即時 AI

直接開啟 index.html 時，助手會明確標示「演示模式」，使用本機規則回覆。要使用 DeepSeek API：

1. 在 DeepSeek Platform 建立 API key。不要把 key 貼到聊天、寫入前端程式或提交到 Git。
2. 在此資料夾的終端機執行 `./start-local.command`，依提示輸入 key；輸入時會顯示，腳本不會把 key 存成檔案。
3. 腳本會自動開啟 http://127.0.0.1:8765。畫面顯示「DeepSeek AI 已啟用」後，新訊息會透過本機 server.js 呼叫 DeepSeek Chat Completions API。請保持終端視窗開啟。

預設模型為 deepseek-flash，可用 DEEPSEEK_MODEL 環境變數調整。由於 file:// 與 http://127.0.0.1 使用不同的瀏覽器儲存空間，切換網址後可能需要重新保存行程。若原本的本機服務仍在運行，請先關閉再重啟，讓新設定生效。

### Windows 啟動

安裝 Node.js 後，在 PowerShell 切換到此資料夾，執行：

```powershell
$env:DEEPSEEK_API_KEY = Read-Host "請輸入 DeepSeek API key"
node server.js
```

在瀏覽器開啟 `http://127.0.0.1:8765/`，保持 PowerShell 視窗開啟。不設定 `DEEPSEEK_API_KEY` 也能以演示模式啟動，但不會連接 DeepSeek。不要把 API key 放入原始碼或提交到 Git。

## 可操作功能

- 查看 CX251 的登機時間、登機口、可用休息時間與貴賓室行程；可修改到達貴賓室的時間，提前安排活動。
- 編輯、移除、重新排序活動；添加服務時檢查時間重疊與登機前時段。
- 添加活動時，服務地點從固定的貴賓室及設施目錄取得，會顯示客運大樓樓層、鄰近閘口及國泰官方介紹，不再以手動輸入欄位代表地點。貴賓室名稱與設施位置參考國泰官方頁面；使用資格仍需以官方資訊為準。
- 「查看候補」直接顯示示範空位與示範排隊名次，並清楚標示尚未連接真實預約系統。此功能不會確認或取消實際預約。
- 保存行程到瀏覽器本機儲存空間，重新載入後保留活動和登機口。
- 使用智能助手畫面的文字、語音輸入與五個快捷入口，體驗重新優化、貴賓室對比、智能推薦和突發修改。
- DeepSeek 可透過結構化工具呼叫提出 `itinerary_proposal`，包含簡短說明及 `add`、`update`、`remove` 操作；一般問答返回 `chat`。前端會先驗證並顯示完整行程預覽、變更摘要和預約提醒，按「確認並保存」才更新行程，按「取消修改」則保留原狀。若預覽後行程已變更，須重新提出需求。
- 行程驗證檢查活動類型、時間格式、服務時長與地點、重疊、貴賓室時段、登機口活動及登機緩衝。更改已確認的服務時段會變成待重新確認；從行程移除已確認服務不會自動取消原預約。
- 智能推薦結合本機保存行程的個人偏好與**原型群體樣本**排序。群體百分比並非真實所有用戶資料；要使用真實群體偏好，需另接後端匿名統計資料。
- 貴賓室對比會依示範登機口顯示預估步行時間。數值是原型示範，並非機場即時路線或精確距離。
- 在支援 Web Speech API 的瀏覽器使用語音輸入；不支援時可使用系統聽寫。

此專案仍是概念原型。航班、空位、排隊名次、登機口變更、推薦群體資料與步行時間為示範資料；即使連接 AI，「保存行程」也不會連接真實國泰系統或送出預約。圖片是為此原型生成的裝飾素材，介面不使用官方標誌。DeepSeek 的真實呼叫需要您自行提供有效 API key；自動測試只使用模擬回應。

地點資料來源：[寰宇堂頭等貴賓室](https://www.cathaypacific.com/cx/zh_TW/destinations/lounges/hong-kong-hkg/the-wing-first.html)、[玲瓏堂](https://www.cathaypacific.com/cx/zh_HK/destinations/lounges/hong-kong-hkg/the-deck.html)。預約資料要改為真實資訊，需接入預約系統提供的空位、候補序號與用戶預約接口；目前 `/api/availability` 僅返回示範資料。

執行現有測試：使用 Node.js 執行 node --test。

## 本機預約資料庫與候補模組

新增的 SQLite 後端獨立於現有介面與 DeepSeek 行程提案。使用 **Node.js 24.15.0 或更高的 24.x 版本**及內建 `node:sqlite`，沒有 npm 依賴，無需 `npm install`。此版本的 `node:sqlite` 屬於 release candidate，用於本機比賽原型。

```sh
npm run db:init
npm run reservations:server
```

預約 API 僅監聽 `http://127.0.0.1:4174`，資料庫保存在 `data/lounge-demo.sqlite`。再次初始化不會重置既有預約。貴賓室設施、會員資格、容量及時段均為虛構示範規則，不代表國泰真實規則。

```sh
npm test
npm run demo:reservations
```

自動測試與端到端演示使用臨時資料庫。演示會實際修改本機資料庫：A 預約最後一個 18:40 按摩名額，B 候補，A 取消後系統向 B 發出邀請，B 接受後成為已確認預約；最後重新啟動獨立伺服器進程驗證資料保留。

現有頁面仍由 `node server.js`（或 `npm start`）在 `http://127.0.0.1:8765/` 提供。**本階段尚未將預約 API 掛載至 `server.js`，也未更改前端或 Agent 行為**；`/api/availability`、候補畫面及 localStorage 中的預約標籤仍使用既有示範資料。4174 是獨立 JSON API，不是介面網址。

參閱[安裝與 Windows 啟動](docs/reservations/README.md)、[資料庫結構與狀態](docs/reservations/schema.md)、[HTTP API](docs/reservations/api.md)、[現有前端與 Agent 整合指南](docs/reservations/integration.md)。
