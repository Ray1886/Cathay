# 网页与服务部署

## 已有 GitHub Pages

公开演示地址：https://ray1886.github.io/Cathay/ 。这是项目站点，所以地址包含 /Cathay/；账号首页 ray1886.github.io 对应独立的同名仓库，不需要为了展示这个项目改仓库名。

仓库已有 `.github/workflows/pages.yml`。main 更新或手动触发后，通过 GitHub Actions 构建并部署。仓库 Settings → Pages 的发布来源使用 GitHub Actions；部署状态在 Actions 中查看。

参考：[GitHub Pages 介绍](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[配置发布来源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

## 静态构建

```sh
npm run build:pages
```

构建只复制 HTML、CSS、浏览器 JavaScript 和公开素材到 `_site/`，写入 staticDemo 标记。不会包含 server.js、backend、数据库、环境变量或 API Key。页面使用相对资源路径，适用于 /Cathay/ 子路径，也可托管到其他静态站点。

Pages 仅运行前端。网页可以浏览、编辑及在设备内保存行程，也有规则演示；数据库预约、事件恢复和 DeepSeek 需要 Node.js 服务。页面会明确提示这些限制，不将不可用接口显示成可提交预约。

## 要让所有人在线使用完整功能

需要另行部署支持 Node.js 与持久化存储的 HTTPS 服务，托管前端、预约 API、恢复引擎和 DeepSeek 代理。

当前服务刻意只绑定 127.0.0.1，并使用 loopback、Host/Origin 及示范用户检查；它不是可直接面向公众的多用户后端。不能只把监听地址改成 0.0.0.0，或把 DeepSeek 密钥放进 Pages。

上线完整服务前，需要确定托管平台，并实现真实用户身份、用户数据隔离、持久卷/数据库备份、请求限额，以及对应的来源与会话策略。推荐前后端同源，减少跨域和第三方 Cookie 差异。GitHub Pages 域名下连接另一个 API 域名也可以设计，但当前代码未实现该远程后端模式。

当前没有为完整服务创建云账号、付费资源、外部数据库或公开 API；已有 Pages 仅发布静态演示。
