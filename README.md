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
- 「查看候补」读取本机 SQLite 的时段、容量、预约、候补名次和限时邀请。可按日期、贵宾室、服务筛选；预约、退出候补、接受邀请、取消及换约均先显示确认页，再写入数据库。
- 保存行程到瀏覽器本機儲存空間，重新載入後保留活動和登機口。
- 使用智能助手畫面的文字、語音輸入與五個快捷入口，體驗重新優化、貴賓室對比、智能推薦和突發修改。
- DeepSeek 可透過結構化工具呼叫提出 `itinerary_proposal`，包含簡短說明及 `add`、`update`、`remove` 操作；一般問答返回 `chat`。前端會先驗證並顯示完整行程預覽、變更摘要和預約提醒，按「確認並保存」才更新行程，按「取消修改」則保留原狀。若預覽後行程已變更，須重新提出需求。
- 行程驗證檢查活動類型、時間格式、服務時長與地點、重疊、貴賓室時段、登機口活動及登機緩衝。更改已確認的服務時段會變成待重新確認；從行程移除已確認服務不會自動取消原預約。
- 智能推薦結合本機保存行程的個人偏好與**原型群體樣本**排序。群體百分比並非真實所有用戶資料；要使用真實群體偏好，需另接後端匿名統計資料。
- 貴賓室對比會依示範登機口顯示預估步行時間。數值是原型示範，並非機場即時路線或精確距離。
- 在支援 Web Speech API 的瀏覽器使用語音輸入；不支援時可使用系統聽寫。

此项目仍是概念原型。库存和候补状态由本机数据库实际计算，但设施、会员、容量、航班与路线规则为示范，并未连接国泰实际预约系统。「保存行程」只保存浏览器活动；时段页单独确认才提交本机预约操作。图片是原型装饰素材。DeepSeek 真实调用需要有效密钥；自动测试使用模拟 AI 回应。

地点参考：[寰宇堂头等贵宾室](https://www.cathaypacific.com/cx/zh_TW/destinations/lounges/hong-kong-hkg/the-wing-first.html)、[玲珑堂](https://www.cathaypacific.com/cx/zh_HK/destinations/lounges/hong-kong-hkg/the-deck.html)。`/api/availability` 已读取本机数据库，不再返回固定示范数量；生产环境仍需真实用户身份和运营库存来源。

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

现有页面由 `node server.js`（或 `npm start`）在 `http://127.0.0.1:8765/` 提供。主服务初始化本机示范数据库，并挂载完整预约 API；时段页与恢复引擎共用数据库。4174 仍可独立运行预约 JSON API，不是界面网址。主服务每 5 秒维护邀请过期与候补递补；打开时段页时每 5 秒刷新状态。

參閱[安裝與 Windows 啟動](docs/reservations/README.md)、[資料庫結構與狀態](docs/reservations/schema.md)、[HTTP API](docs/reservations/api.md)、[現有前端與 Agent 整合指南](docs/reservations/integration.md)。

## 突发修改与恢复

主界面的「突发修改」支持晚到、模拟登机口变更、起飞延误和独立登机时间变化。支持跨午夜日期、动态步行及贵宾室转移约束；未知路线不猜测。系统先更新旅程事实，再生成行程预览，确认后才保存活动。取消草案仍保留新事实与风险提示。

恢复确认会重新核对旅程、活动和示范空位；已确认预约改期变为待确认，从行程移除不自动取消实际预约。DeepSeek 解释恢复建议，AI 失败不影响本地恢复规则。

Ubuntu WSL 使用 Node.js 24.15.0 以上的 24.x 版本，无需安装 npm 依赖：

```bash
cd /home/lotrave/projects/skyward/Cathay
node server.js
```

另开终端隐藏输入密钥，并只配置到服务内存：

```bash
read -r -s -p 'DeepSeek API Key: ' DEEPSEEK_API_KEY; printf '\n'
export DEEPSEEK_API_KEY
node scripts/configure-ai.js
unset DEEPSEEK_API_KEY
```

打开 http://127.0.0.1:8765/ ，刷新后使用智能助手。服务重启后需重新配置，配置成功还需实际获得 AI 回复才能验证认证。请勿把密钥贴到聊天、写入源码或提交 Git。

当前 `node --test` 共 121 项测试通过；时段预约整合新增 9 项，验证确认、数据库同步、FIFO 邀请、过期拒绝、换约竞争、幂等重试和请求途中行程变化保护。详见 [恢复模块](recovery/README.md)、[整合契约](recovery/INTEGRATION.md) 与 [时段预约界面](docs/reservations/frontend.md)。
