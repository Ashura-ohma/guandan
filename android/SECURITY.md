# Android 1.2.0 离线与音频安全边界

## 保持不变的边界

- 包名 `io.neonguandan.game`，versionName `1.2.0`，versionCode `3`
- 不申请 Android 权限；无 INTERNET、录音、存储、通知或后台服务权限
- 无广告、分析 SDK、账号、远程代码、网络音频或新增媒体文件
- 关闭 WebView 调试、文件和 Content URI 访问、混合内容与网络加载
- 本地 HTTPS 资源由宿主拦截提供，使用 `nosniff`，网页 CSP 禁止连接、媒体加载、嵌套页面、worker 和对象
- JavaScript 不具有原生桥接；仅两个已验证的主页 GET 导航命令可切换原生方向
- 应用本地存档及统计不上传，关闭 Android 系统备份
- 只沿用原签名密钥；源码仅包含公开证书 SHA-256，不包含任何私钥或密码

## 六个精确资源

只允许 GET 访问 `https://appassets.androidplatform.net/assets/www/` 下完整、大小写一致的以下 URL：

- `index.html`
- `style.css`
- `game.js`
- `engine.js`
- `audio.js`
- `hand-layout.js`

`ResourcePolicy` 使用完整字符串匹配，不进行 URI 解码或路径规范化。查询串、片段、端口、用户信息、别名域名、编码路径、目录穿越、其他 HTTP 方法及其他资源都被拒绝。资源白名单与原生导航白名单分开测试，JavaScript 文件不能作为主框架页面加载。

音效与可选音乐是 WebAudio 本地合成，`media-src 'none'` 和 `connect-src 'none'` 仍保留。离线音频不需要网络或录音权限。

## 生命周期和音频限制

宿主在暂停、失焦和退出确认时发送 `guandan-pause`；活动恢复且具有窗口焦点时才发送 `guandan-resume`。前端需在 pause 处理器中立即静音、停止调度并请求 AudioContext 挂起；恢复仍须遵守用户已主动开启的选择，不能自动开启音乐。

`onPause` 等待 JavaScript 事件分发回调后调用 `WebView.onPause` / `pauseTimers`。回调携带生命周期编号及 WebView 身份检查，快速恢复或销毁不会让旧回调再次冻结当前页面。JavaScript 回调说明同步事件处理器已运行，不代表异步 AudioContext 挂起和设备音频输出已完成；必须检查真实设备。

当前未实现原生 AudioManager 音频焦点，也未创建音频桥接。启动时不主动抢占其他应用音频。WebView / 系统的焦点策略、来电、duck、蓝牙和耳机拔出行为不能仅凭这些源码测试保证；需要按 README 的设备清单验收。[Android 官方音频焦点要求](https://developer.android.com/media/optimize/audio-focus)说明完整跨应用音频协调还需要专门的焦点集成。

## 验证与未验证事项

`test-wrapper.py` 对 41 个导航场景及 135 个资源场景运行真实 JVM 逻辑测试，并检查清单、旋转、无桥接、用户音频手势及生命周期源码约束。生命周期源码检查不是 Android 回调执行测试。

`test-package.py` 的 19 个回归场景使用临时合成 ZIP 和 SDK 输出桩，仅验证校验器的拒绝逻辑。正式构建随后对真实 APK 运行 AAPT、zipalign、apksigner 与资源哈希检查，拒绝额外 / 缺失资源、重复 ZIP 条目、凭证类文件、错误版本、额外权限和非原版签名。

当前未进行真机或模拟器上的覆盖安装、启动、横竖屏切换、音频、后台恢复、耳机 / 蓝牙 / 来电和跨应用焦点测试。不得将源码测试或网页测试描述为这些设备测试已通过。
