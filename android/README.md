# 星曜掼蛋 Android 离线版

## 安装与运行

- 安装包：`guandan-1.0.0.apk`；包名：`io.neonguandan.game`
- Android 8.0 / API 26 及以上；建议保持 Android System WebView 更新
- 支持手机、平板，以及横竖屏。旋转屏幕不会重新加载牌局
- 无需联网、登录或充值，无广告，不申请任何 Android 权限
- 应用切入后台、失去焦点或弹出退出确认时，暂停电脑玩家；重新回到游戏时继续
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

`FRAMEWORK_RES` 可指定独立的资源平台文件。此次构建复用已有的官方来源工具：Debian AOSP packaging / signing 工具、Google Maven R8 8.7.18、Maven Central Robolectric Android 15 API jar（Java 编译），以及 Debian framework-res.apk（资源编译）。无需新下载、安装运行时或接受额外 SDK 协议。

## 实现与安全

`prepare-assets.py` 复制项目根目录的 `index.html`、`style.css`、`game.js` 和 `engine.js`，向打包版本增加 CSP 以及 Android 触控样式。构建输出 `asset-checksums.json` 记录输入与 APK 资源校验和，便于核对最终包版本。

WebView 使用被本地拦截的 HTTPS origin，并只读取四个固定 APK 内资源。其余路径、外部页面、网络请求、文件访问和 Content URI 访问均不允许。没有 JavaScript-native bridge、广告、分析 SDK、后台服务或远程代码。WebView 本地存储保存牌局与统计，Android 系统备份关闭。

原生宿主向网页发送 `guandan-pause` / `guandan-resume` 生命周期事件。游戏应自行保存局面、暂停 AI 定时器，并只在可见时恢复。屏幕旋转由同一 Activity / WebView 处理，显示刘海区域由原生安全边距避让。

`make-icon.py` 生成本项目原创几何扑克牌图标，需要 Pillow 与 DejaVu Sans 字体。图标已经生成，常规 APK 构建无需重新生成。

## 验证边界

构建脚本检查 Java 编译、DEX 转换、APK 签名、ZIP 完整性、zipalign 与 Manifest。最终验证结果在 `build/verification.txt`。

当前环境没有 Android 真机或模拟器，因此尚未进行实际 Android 启动、原生横竖屏切换、后台恢复、系统返回键与音频端到端验证。网页与引擎的测试结果不能替代这些设备测试。
