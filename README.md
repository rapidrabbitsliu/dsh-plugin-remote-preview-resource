# DSH Remote Media Preview / 远程音视频预览

通过现有 DeepSeek Harness（DSH）Web GUI 的 HTTP(S) 地址播放服务器生成的音频、视频，不再调用服务器本机的默认应用。点击会话里的同源预览链接时，在当前页面打开适配手机的播放浮层，也保留独立播放器页面。

这是独立的社区插件，非 DeepSeek 官方产品。许可证：MIT。

## 功能

- 复用 GUI 端口、协议及 DSH Connection 的 owner 鉴权，不另开服务器。
- `preview_media` 工具返回播放器页面 `previewUrl` 和媒体流 `mediaUrl`。
- 同源链接打开原生 dialog 浮层，支持关闭按钮、Escape、遮罩关闭；关闭时停止媒体并恢复焦点，来源内容移除时关闭。
- 普通链接、下载、修饰键点击及跨域链接保留原导航；提供“在新页面打开”。不支持 dialog 的浏览器退回独立页面。
- GET / HEAD、单段 Range、206 / 416，支持拖动进度，以流传输，不整体读入内存。
- 支持 MP3、WAV、OGG、OPUS、M4A、AAC、FLAC、MP4、M4V、WebM、OGV、MOV。不转码，实际播放取决于浏览器和编码，推荐 MP3、MP4 H.264/AAC 或 WebM。

不改造现有 `present` 文件卡片，不支持 TXT 或任意磁盘文件，不提供匿名分享链接。

## 安装

要求 Node.js 22.19+ 或 24+、支持 `connection.fetch` 的 DSH Web 版本。当前按 DSH `0.2.1-rc.3` API 核验，不承诺其他不兼容 API 版本。

安装到你**现有的 GUI profile**，将 `my-web` 换成实际名称：

```powershell
dsh plugin --profile my-web add dsh-plugin-remote-preview-resource
```

也可安装 GitHub Release 的 tarball 或本地源码目录：

```powershell
dsh plugin --profile my-web add ./dsh-plugin-remote-preview-resource-0.1.0.tgz
```

不要新建不含 GUI bundle 的空 profile。默认未配置时不注册媒体接口或工具；先配置，再重启原 GUI 并刷新浏览器。新增客户端模块需要重启以清除旧的模块发现缓存。客户端构建产物已包含，无需另开前端服务器。

## 配置

在 profile 的 `cordis.patch.yml` 添加如下行（已有此 id 时修改，不重复添加）：

```yaml
- id: remote-preview-resource
  name: dsh-plugin-remote-preview-resource
  config:
    mediaRoot: 'C:/DSH-Media'
    publicBaseUrl: 'https://harness.example.com/'
```

- `mediaRoot`：绝对路径、专用于可预览媒体，不存在时创建。Linux 示例 `/srv/dsh-media`。不要配置整盘、用户主目录或含秘密的项目根目录。
- `publicBaseUrl`：远程浏览器实际访问并登录 GUI 的 HTTP(S) 地址，含代理前缀（如 `https://example.com/dsh/`）。局域网/Tailscale 可使用对应 IP 和原 GUI 端口，勿误填远程设备自身 localhost。
- 两项都未配置时保持未启用状态；只配置一项或非法值时明确报错。后层会整体替换该行 config，修改时保留两项。
- 不在地址中放登录 token、用户名密码、查询参数或片段；插件不从不可信请求头猜公开地址。

浮层仅接管与当前 GUI **同源且路径匹配**的链接。用局域网域名访问却配置为另一 Tailscale 域名时会正常导航独立页面，但不打开浮层，登录 cookie 也可能不共享。应统一 GUI 地址。

用 `dsh --profile my-web --dump-config` 检查结果，再重启原 GUI。插件不会让只有回环监听的 GUI 自动从外网可达；使用安全远程部署、HTTPS 代理或 SSH 转发，不关闭鉴权。

## 会话中使用

让模型将媒体保存到该目录，或在权限允许时先复制进去，再调用 `preview_media`：

```json
{ "file": "demo.mp4" }
```

`file` 相对于 **mediaRoot** 而不是会话工作目录，也接受目录内的绝对路径，支持中文、空格和子目录。工具不复制、移动、删除文件，不扩大模型写权限。

示例指令：

> 把生成的视频保存到插件媒体目录，调用 preview_media，在回复中给我 previewUrl 播放链接，不要用本地路径打开。

返回示例：

```json
{
  "file": "demo.mp4",
  "mimeType": "video/mp4",
  "bytes": 123456,
  "previewUrl": "https://harness.example.com/api/remote-preview-resource?file=demo.mp4&view=player",
  "mediaUrl": "https://harness.example.com/api/remote-preview-resource?file=demo.mp4&view=stream"
}
```

回复使用普通 Markdown 链接：

```markdown
[播放视频](https://harness.example.com/api/remote-preview-resource?file=demo.mp4&view=player)
```

链接读取当前文件，不是永久快照，删除后返回 404。也可手动构造链接，须 URL 编码文件名。

## 权限与限制

- `/api/remote-preview-resource` 走 DSH Connection 共享通道，复用 Host/Origin 校验及鉴权，仅 owner 可访问。URL 不是匿名凭证，新设备需先登录同一 GUI；跨站入口可能被拒绝。
- 目录内所有受支持文件均可被 owner 读取，**不按会话隔离**。扩展名白名单不是内容扫描，只放可信媒体。
- 校验路径范围和解析后符号链接目标。**目录及父目录只能由可信用户/进程写入**：realpath 后打开不能抵御恶意本地写者并发替换目录的竞态，不适合不可信多租户托管。
- 没有过期链接、自动清理、配额或跨会话授权，部署者负责容量、权限和保留时间。
- 反向代理须转发 GUI 的 `/api`，保留 Range / If-Range 及 206 / Content-Range，不将接口另配成匿名静态服务。
- 停用后清理路由、工具、浮层和点击监听，不删除媒体文件。也可卸载：

```powershell
dsh plugin --profile my-web remove dsh-plugin-remote-preview-resource
```

## 开发与验证

无 npm 运行时依赖；客户端是 DSH 模块格式的 JS，不使用第二份 React。

```powershell
npm run check
npm test
npm run test:browser
npm pack --dry-run
```

浏览器测试需单独安装 Playwright 和 Chromium：

```powershell
npm install --no-save playwright
npx playwright install chromium
```

或用 `PLAYWRIGHT_MODULE` 指定可解析模块路径、`CHROME_PATH` 指定 Chrome。浏览器测试用隔离页面、模拟模块加载器及合成响应验证浮层、手机布局、链接范围和清理，不启动替代 DSH 服务器，不等于真实 DSH 鉴权验证。

单元测试覆盖 GET、HEAD、Range、If-Range、空文件、类型过滤、路径/junction 越界、HTML 转义、代理前缀、流取消和注册。Windows 受限沙箱若阻止子进程管道，可显式用 `node --test --test-isolation=none test/*.test.js`。

开发期间在 DSH 实例实测媒体页面 200、HEAD 200、Range 206，并使用真实 H.264/AAC 短视频检查读取和解码。浮层 DOM 已经浏览器交互测试；新安装应重启刷新后检查实际客户端加载。测试视频和生成素材不随源码或 npm 包发布。

源码：[Host](src/index.js)、[媒体服务](src/media.js)、[浮层](client.js)。
