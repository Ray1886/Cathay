# Cathay · 贵宾室智能行程

基于原生 HTML、CSS、JavaScript 和 Node.js 的贵宾室行程原型，支持行程规划、预约候补、突发恢复及 DeepSeek 助手。

[在线演示](https://ray1886.github.io/Cathay/) · [本地启动](docs/getting-started.md) · [部署说明](docs/deployment.md) · [界面设计](DESIGN.md)

## 选择体验方式

| 能力 | 网页演示（GitHub Pages） | 本地完整服务 |
|---|---|---|
| 浏览界面、编辑行程、设备内保存 | 支持 | 支持 |
| 规则演示、贵宾室对比与推荐 | 支持 | 支持 |
| 数据库时段、预约与候补 | 不提供 | 支持 SQLite |
| 突发事件恢复与确认草案 | 不提供 | 支持 |
| DeepSeek 实时对话 | 不提供 | 提供密钥后启用 |

网页演示可直接在 Windows、macOS、Linux、iOS 和 Android 的现代浏览器中打开，无需安装。完整服务需要运行 Node.js，浏览器负责显示界面。

## 本地快速开始

要求：**Node.js 24.15.0 或以上的 24.x 版本**，使用内置 SQLite，没有第三方 npm 依赖。

```sh
git clone https://github.com/Ray1886/Cathay.git
cd Cathay
npm run start:open
```

使用 DeepSeek：

```sh
npm run start:ai
```

按提示隐藏输入密钥。启动器会打开浏览器，保持终端运行；按 Ctrl+C 停止。也可执行 `npm start` 后手动访问 http://127.0.0.1:8765/ 。同一组命令适用于 Windows PowerShell、macOS、Linux 和 Ubuntu WSL；WSL 的 Node.js 应安装在 Ubuntu 内。

## 项目功能

- 查看航班与可用时间，编辑、排序和保存贵宾室活动。
- 查询数据库时段，确认预约、换约、取消及 FIFO 候补邀请。
- 处理晚到、模拟登机口/登机时间变化及延误，确认后保存恢复草案。
- 通过 DeepSeek 生成对话与行程提案；预约操作仍需用户明确确认。

## 开发与文档

```sh
npm test
npm run build:pages
```

- [跨平台启动与常见问题](docs/getting-started.md)
- [GitHub Pages 与完整服务部署](docs/deployment.md)
- [预约界面](docs/reservations/frontend.md) · [预约 API](docs/reservations/api.md)
- [数据库结构](docs/reservations/schema.md) · [恢复引擎](recovery/README.md)

运营后台目前在独立的 `feature/operations-dashboard` 分支，尚未合并至主线。

## 数据与密钥

这是概念原型，航班、路线、会员及容量规则为示范，不代表国泰实际服务。SQLite 数据保存在本机 `data/lounge-demo.sqlite`；浏览器行程仅保存在当前设备。启动不会重置现有数据库。

DeepSeek 密钥仅供服务端使用，不写入前端、源码、数据库或 GitHub Pages。完整服务默认仅监听本机。字体随项目提供，其授权见 [字体说明](assets/fonts/README.md)。
