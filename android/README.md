# 星曜掼蛋 Android 离线版

## 安装与运行

- 安装包：`guandan-1.2.0.apk`；版本号：1.2.0（versionCode 3）；包名：`io.neonguandan.game`
- Android 8.0 / API 26 及以上；建议保持 Android System WebView 更新
- 支持手机、平板，以及横竖屏。默认跟随重力感应，即使系统锁定旋转仍可转屏
- 顶部横屏按钮请求 Android 原生横屏（可向左或向右横握），再次选择自动则恢复四方向感应。旋转屏幕不会重新加载牌局
- 无需联网、登录或充值，无广告，不申请任何 Android 权限
- 应用切入后台、失去焦点或弹出退出确认时，暂停电脑玩家及游戏音频；重新回到游戏时按用户当前音频选择继续
- 音乐必须通过游戏内按钮主动开启，不自动播放；音效与音乐由本地 WebAudio 生成，无音频下载或媒体文件
- 返回键显示退出确认。进度保存在应用本地，清除应用数据或卸载会移除记录
- 这是开发证书签名的独立安装包，尚非应用商店发行版。安装时遵循 Android 的系统安全检查；不需要关闭 Play Protect

## 构建

先在项目根目录执行 `npm test`。准备 JDK 21、Python 3、zip/unzip、AAPT、zipalign、D8/R8 和 apksigner，然后：

```sh
export ANDROID_JAR=/path/to/android-sdk/platforms/android-35/android.jar
export AAPT=/path/to/android-sdk/build-tools/35.0.0/aapt
export ZIPALIGN=/path/to/android-sdk/build-tools/35.0.0/zipalign
export D8_JAR=/path/to/android-sdk/build-tools/35.0.0/lib/d8.jar
export APKSIGNER_JAR=/path/to/android-sdk/build-tools/35.0.0/lib/apksigner.jar
export SIGNING_KEYSTORE=/private/path/development.jks
export SIGNING_PASSWORD_FILE=/private/path/password.txt
./android/build.sh
```

签名密钥与密码必须在源码目录外保存。用原签名密钥签署后续版本，才能覆盖升级现有安装。源码不包含密钥或密码。

本次 1.2.0（versionCode 3）沿用 1.0.0 / 1.1.0 的包名与原签名密钥，可覆盖安装并保留应用本地数据；不要先卸载旧版。`signer-certificate.sha256` 保存原版公开签名证书的指纹（不是密钥），构建验证会拒绝其他证书。构建后也可分别用 `apksigner verify --print-certs` 比对两个 APK 的证书 SHA-256。覆盖安装与存档恢复仍需在实际 Android 设备上验证。

`FRAMEWORK_RES` 可指定独立的资源平台文件。此次构建复用已有的官方来源工具：Debian AOSP packaging / signing 工具、Google Maven R8 8.7.18、Maven Central Robolectric Android 15 API jar（Java 编译），以及 Debian framework-res.apk（资源编译）。无需新下载、安装运行时或接受额外 SDK 协议。

## 实现与安全

`prepare-assets.py` 复制项目根目录的 `index.html`、`style.css`、`game.js`、`engine.js`、`audio.js` 和 `hand-layout.js`，向打包版本增加 CSP 以及 Android 触控样式。构建输出 `asset-checksums.json` 记录输入与 APK 资源校验和，便于核对最终包版本。

WebView 使用被本地拦截的 HTTPS origin，并只读取六个固定 APK 内资源。资源请求按完整 URL 及 GET 方法精确匹配；查询串、片段、端口、大小写别名、编码路径和目录穿越均不能扩大白名单。其余资源路径、外部页面、网络请求、文件访问和 Content URI 访问均不允许。没有 JavaScript-native bridge、广告、分析 SDK、后台服务或远程代码。WebView 本地存储保存牌局与统计，Android 系统备份关闭。

仅有两个精确的本地导航命令：`https://appassets.androidplatform.net/ui/landscape` 与 `https://appassets.androidplatform.net/ui/auto`。来自已加载游戏主页的主框架 GET 导航分别触发 `SENSOR_LANDSCAPE` 与 `FULL_SENSOR`；命令被立即消费，不加载新页面，不发起网络请求。查询串、端口、片段、其他路径和其他来源均不能触发原生操作。浏览器部署不会使用这两个宿主命令。

原生宿主向网页发送 `guandan-pause` / `guandan-resume` 生命周期事件。游戏自行保存局面、暂停 AI 定时器，并在 pause 处理器中同步静音、清理音频调度和请求挂起 AudioContext，只在可见且用户已选择开启时恢复。`WebView.pauseTimers()` 本身不保证 WebAudio 停止，因此宿主在 pause 事件的 JavaScript 回调后才冻结 WebView，且丢弃快速恢复或销毁后的过期回调；该回调不等于音频硬件已经完成挂起。屏幕旋转由同一 Activity / WebView 处理，旋转后重新申请安全边距，显示刘海区域由原生安全边距避让。关闭并重新打开应用时默认恢复自动转屏。

音频交互不增加原生桥接或 Android 权限。保留 `setMediaPlaybackRequiresUserGesture(true)`，前端另行负责用户主动开启门槛。当前没有接入原生 `AudioManager` 音频焦点，不会在启动时抢占其他应用的音频；跨应用抢占、电话、蓝牙以及耳机拔出时的表现依赖 Android / WebView，尚不能保证自动 duck / 焦点恢复。不要把网页生命周期暂停等同于完整的原生音频焦点支持，参见 [Android 音频焦点说明](https://developer.android.com/media/optimize/audio-focus) 与 [WebView API](https://developer.android.com/reference/android/webkit/WebView)。

方向行为采用 [Android 官方 Activity 方向规则](https://developer.android.com/guide/topics/manifest/activity-element#screen)；分屏、特定平板或厂商兼容设置仍可能由系统决定最终窗口方向。

`make-icon.py` 生成本项目原创几何扑克牌图标，需要 Pillow 与 DejaVu Sans 字体。图标已经生成，常规 APK 构建无需重新生成。

## 验证边界

构建脚本先运行 `test-wrapper.py`，检查 41 项精确导航规则、135 项资源白名单规则，以及默认方向、旋转配置、用户音频手势与生命周期回调约束；`test-package.py` 使用合成 ZIP 和 SDK 输出桩运行 19 项验证器回归测试（包括缺失音频模块、额外媒体、重复 ZIP 条目、源文件变化、权限及签名不匹配）。随后检查 Java 编译、DEX 转换、APK 签名、ZIP 完整性、zipalign、Manifest 版本及编译后的 `FULL_SENSOR`。最终验证结果在 `build/verification.txt`。白名单测试是在 JVM 中运行的逻辑测试，并非 Android 模拟器测试。最终 APK 还必须通过真实 SDK 工具、证书及资源哈希验证；合成测试不能替代这一步。

当前环境没有 Android 真机或模拟器，因此尚未进行实际 Android 启动、原生横竖屏切换、后台恢复、系统返回键与音频端到端验证。网页与引擎的测试结果不能替代这些设备测试。

设备验收清单：

1. 在保留 1.0.0 或 1.1.0 应用数据的情况下覆盖安装 1.2.0，检查牌局和统计
2. 系统锁定竖屏时启动应用，点顶部横屏按钮，确认进入真正横屏且手牌不变
3. 连续点击横屏 / 自动，左右横握、竖握各测试一次，确认按钮仍可操作且没有重开牌局
4. 牌局中转屏，确认 AI 回合、计时与选牌没有重复触发，刘海不会遮挡按钮
5. 开启音乐后按 Home、锁屏、切后台及快速反复恢复，检查背景无音乐、AI 暂停 / 恢复、无重复出牌或音频叠加
6. 返回键打开退出确认时应静音，取消后继续原局；退出并重新打开后默认自动转屏，音乐不应未经主动开启就播放
7. 在较小手机及带刘海设备上检查横屏触控、音频与安全边距
8. 另一应用正在播放音乐时启动本游戏；分别测试主动开启 / 关闭音乐、来电或通知打断、蓝牙切换及拔出耳机，记录厂商 / WebView 的实际音频焦点行为

完整离线边界及音频验证限制见 [SECURITY.md](SECURITY.md)。
