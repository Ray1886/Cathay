# 跨平台启动

## 环境

完整服务使用 Node.js 24.15.0 或以上的 24.x，依赖内置 node:sqlite。Windows、macOS 和 Linux 的命令一致，不需要 npm install。Node.js 安装请使用 [官方网站](https://nodejs.org/)；项目不会自动安装或升级软件。

```sh
node --version
npm --version
git clone https://github.com/Ray1886/Cathay.git
cd Cathay
```

Windows 使用 PowerShell/Windows Terminal；macOS、Linux 使用终端。若只是体验 UI，可直接访问 [网页演示](https://ray1886.github.io/Cathay/)，无需 Node.js。

## 启动与停止

```sh
npm run start:open
```

自动启动并尝试打开系统浏览器。自动打开失败时，手动访问 http://127.0.0.1:8765/ 。保持终端打开，Ctrl+C 停止。

启用 DeepSeek：

```sh
npm run start:ai
```

终端隐藏输入密钥，密钥仅保存在进程内存；关闭或重启后需重新输入。已有 DEEPSEEK_API_KEY 环境变量时不重复询问。不要把密钥作为命令参数直接粘贴，以免进入命令历史。

`npm start` 保留最基本的 `node server.js` 启动方式；不自动询问密钥或打开浏览器。macOS 旧入口 start-local.command 现在也使用统一启动器。

## Ubuntu WSL

在 Windows PowerShell 执行（使用自己的项目路径）：

```powershell
wsl -d Ubuntu --cd /home/your-user/projects/Cathay -- npm run start:ai
```

Node.js 需要安装在 Ubuntu 内；也可以进入 Ubuntu 后运行通用命令。浏览器仍使用 Windows 中的 Edge/Chrome，访问相同的 http://127.0.0.1:8765/ 。自动打开依赖系统浏览器/WSL 互操作；不可用时手动打开即可。

## 常见问题

- **端口被占用**：先打开已有服务，或在它的终端 Ctrl+C；不要重复启动或结束不明进程。
- **PowerShell 阻止 npm.ps1**：改用 `npm.cmd run start:open` / `npm.cmd run start:ai`，无需修改执行策略。
- **数据库没有今天的时段**：种子只初始化空库，不自动更改已有日期。可在预约页查看既有日期；不要为查看 UI 删除数据库。
- **网页仍显示旧样式**：Ctrl+F5（macOS 可使用浏览器的强制刷新）。
- **语音不可用**：语音依赖浏览器和系统权限；文字输入始终保留。Firefox、Safari、移动浏览器等实现可能不同，不能保证语音识别完全一致。
- **手机上打开**：网页演示直接可用。完整服务默认只监听运行它的电脑，手机的 127.0.0.1 不会连接电脑。远程完整服务需要单独部署。
- **直接双击 index.html**：只作为静态演示，不提供预约或 AI；优先使用 Pages 或 Node.js 服务。

## 数据

浏览器行程使用 localStorage，不在不同浏览器、设备、端口或域名之间共享。SQLite 预约以本机数据库为准；源码 ZIP 和 GitHub Pages 都不包含运行中的数据库及密钥。

开发测试：`npm test`。静态打包：`npm run build:pages`，输出 `_site/`。
