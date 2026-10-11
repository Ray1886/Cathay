# 主项目整合契约

## 数据与事件

`integration.stateFromContext` 将主界面活动与旅程转换为规范状态。活动保留稳定 ID、类型、地点与预约关联；startAt/endAt 是带日期及偏移的完整时间，start/end 用于显示。旅程默认示范 CX251、demo-user；20:00 起飞仅为显式示范值，不据此推算登机。

用户晚到来源是 passenger；登机口、登机时间和延误按钮由服务端生成 mock_flight_provider 事件。聊天不会把用户声称的航班变化当作真实航空通知。未来真实数据需接入层鉴权及持久化。

## HTTP 流程

1. `POST /api/recovery`：action 为 late/gate/delay/boarding，附最新 context。返回独立的新事实 state、impact、result、主界面 proposal 和 previewId，原活动不变。
2. 主界面保存事实、显示来源及风险，旧草案失效；展示完整活动预览及预约提醒。取消只取消草案。
3. `POST /api/recovery/confirm`：提交 previewId 和当前 context。服务端核对全旅程签名、校验时间和转移约束，对改期预约服务重新读库存。变更返回 409，不部分应用。成功返回 draft 与 bookingCommitted:false。
4. 前端再次核对签名及草案后保存，重复点击不重复执行。实际预约事务未执行。
5. `POST /api/recovery/explain`：DeepSeek 只解释缓存中的确定性结果，无工具执行权限；认证、余额、限流失败返回脱敏错误。

这些 POST 接口仅限 loopback 且 Host/Origin 匹配。草案 10 分钟有效；服务重启后必须重做。

## 共享校验与库存

`itinerary.js` 通过 journey 与 startAt/endAt 验证跨日时间；walkingMinutes 动态决定 gate 活动时长。转移和步行由根 travel-time.js 共享，不根据闸口数字差推算。

SQLite 适配器绑定示范用户 1，映射 wing=1、pier=2、deck=5；bridge 无映射。仅调用查询接口，不修改预约表或事件表。改约不自动确认；已确认服务从行程移除仍需单独处理原预约。

## 本地 DeepSeek 配置

主服务监听 127.0.0.1:8765。启动时可读取 DEEPSEEK_API_KEY；也可终端隐藏输入后运行 `node scripts/configure-ai.js`，经本地 `/api/configure` 配置进程内存。不向前端返回密钥，不保存配置文件。服务重启后需重新输入。

下一阶段可加入可信航班订阅、服务端旅程持久化及预约事务，事务成功前不得将待确认状态显示为真实已预约。
