# IPA 安装助手（Windows）

配合「IPA 取件站」用：取件站负责把指定版本 IPA 下到服务器，这个助手负责把 IPA 装进 iPhone。

## 用法
1. 电脑装一次微软商店的免费 App「Apple 设备」（提供苹果驱动，不用装 iTunes）。
2. 手机用数据线连电脑，解锁，弹窗点「信任」。
3. 打开 IPA安装助手.exe，粘贴取件站链接（保存一次即可），刷新列表，选中 IPA 点「安装选中」。

装的是自己账号的商店原版包：国区账号下的直接能打开；美区下的 App，手机上要登录过美区账号（设置→媒体与购买项目）才能打开。

源码 installer.py 由 GitHub Actions 自动打包成 exe，发布在本仓库 Releases 的 installer-v1 里。
