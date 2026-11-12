# ZFBpay v1 —— 支付宝精简 + 悬浮底栏

AlipayLite 的重建版：18 个钩子全部来自 AlipayLite.dylib 反汇编实证，另加按 FrostBar 手册技术重建的磨砂悬浮底栏、长按设置面板、启动恢复上次 Tab。Substrate 路线（MSHookMessageEx），与原二进制同款。

> ⚠️ 诚实说明：源码在 Linux 上写成，**未经编译、未经真机验证**。首次构建结果以 GitHub Actions 运行为准；全部“重建实现”部分待真机验证后才能算数。已验证与重建的界线见下表，代码注释里也逐一标注。

## 功能（六个开关，默认全开）

| 开关 | 作用 |
|---|---|
| 悬浮底栏 | 显示磨砂悬浮底栏，关闭则恢复原底栏（逃生口） |
| 底部搜索条 | 显示底部搜索条（点按唤起搜索） |
| 信息流屏蔽 | 屏蔽首页信息流（HFStreamingComponent） |
| 卡片净化 | 净化提醒卡片与历史、动态卡片、搜索页小卡片 |
| 顶部导航净化 | 隐藏顶部导航多余内容，并调整首页布局（setFrame: 钳制） |
| 启动恢复上次 Tab | 启动时回到上次停留的 Tab |

另外保留了原二进制的暗门：长按首页“+”跳到第 4 个 Tab。

## 设置面板：长按底部呼出

在悬浮底栏上**长按约 0.5 秒**，震动后弹出设置面板，开关即时生效（触发一次布局即可看到变化）。开关存在 App 的 Documents 目录下 `ZFBpay.plist`。

边界处理：手势挂在 tabBar 所在容器上，不是悬浮栏本身。悬浮栏显示时触发区是悬浮栏本身（放宽 8pt）；悬浮栏被关掉后，触发区变成底部 120pt + 安全区——关掉悬浮栏后仍能长按底部把面板呼出来重新打开，不会锁死。

## 已验证 vs 重建对照表

“已验证还原”= AlipayLite 反汇编函数体逐行实读后等价重写，含实测常量；“重建实现”= 按手册/分析重建，无二进制对照，待真机验证。

| # | 类 / 方法 | 标注 |
|---|---|---|
| 1 | LATabBar `layoutSubviews` | 已验证还原（藏原底栏 + 建搜索条；搜索条几何重写为安全区感知） |
| 2 | LATabBar `setHidden:` | 已验证还原（强制 YES；开关关闭时放行原值） |
| 3 | LATabBar `setAlpha:` | 已验证还原（强制 0；开关关闭时放行原值） |
| 4 | LATabBar `handleBottomSearchTap:`（新增） | 已验证还原（唤起逻辑原样；keyWindow 查找改 scene 感知 + 备用路径） |
| 5 | APHomeNaviView `layoutSubviews` | 已验证还原（只留 RightBarButtonsBox） |
| 6 | HFNTabMainCollectionView `setFrame:` | 已验证还原（y > 20 则 y = 54） |
| 7 | HMoreNavItemView `layoutSubviews` | 已验证还原（dispatch_once 加 0.5s 长按手势） |
| 8 | HMoreNavItemView `handlePlusLongPress:`（新增） | 已验证还原（长按“+”跳第 4 个 Tab） |
| 9–13 | HFStreamingComponent ×5 | 已验证还原（身处 HFNTabPageScrollView 内则隐藏/压制） |
| 14 | HFMsgRemindCollectionViewCell `layoutSubviews` | 已验证还原（无条件隐藏） |
| 15 | HCommonUseView `layoutSubviews` | 已验证还原（身处 HFNTabMainCollectionView 内则隐藏） |
| 16–17 | APGFrontNativeHistoryCell / APGDynamicCardCell `layoutSubviews` | 已验证还原（身处 APGDynamicTableView 且在搜索页内则隐藏） |
| 18 | AUKView `layoutSubviews` | 已验证还原（搜索页底部小卡片上爬隐藏，常量 0.7/220/90/360/140 实测） |
| — | 内部 helper：搜索唤起 / 找 Tab 控制器 / hideView / isInsideClass / isInsideSearchVC | 已验证还原 |
| — | 磨砂悬浮底栏（动态取原 tabBar items、搜索钮、角标） | 重建实现 |
| — | 长按设置面板（自有 UIWindow + 卡片 + 表格） | 重建实现 |
| — | 启动恢复上次 Tab（0.4s 延迟 + 8×0.25s 重试 + 顺序签名） | 重建实现 |
| — | scene 感知 keyWindow + 备用唤起路径 | 重建实现 |
| — | bundleId 自检门 | 写法仿酷安；`com.alipay.iphoneclient` **待用户核实** |

## 构建方式

### 方式一：GitHub Actions 自动构建（推荐）

工作流：`.github/workflows/zfbpay.yml`，手动触发（仓库 Actions 页 → “构建 ZFBpay dylib” → Run workflow）。

产物：artifact 名 **`ZFBpay-dylib`**，内含 `ZFBpay.dylib`（arm64 + arm64e 双架构）。只编译、不打包、不签名。

### 方式二：本地 Theos 构建

需要 macOS + Xcode + Theos：

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/theos/theos/master/bin/install-theos)"
export THEOS=~/theos
cd ZFBpay
make
```

产物在 `.theos/obj/debug/ZFBpay.dylib`（debug 构建，带符号，便于首轮排查）。

工程说明：Theos 工程（Makefile + Tweak.m + control），`ARCHS = arm64 arm64e`，部署目标 iOS 15.0，ARC（显式 `-fobjc-arc`，偏离手册 MRC 写法——无编译器可验时 ARC 更安全），`-fno-modules`。

## 安装

dylib 编出后，**由用户自行证书签名注入**，与手机上现有的三个 dylib 同一流程。本仓库不提供签名与注入工具。

## iPhone 18 Pro Max 适配

- 全部布局按实时 `bounds` + `safeAreaInsets` 计算，无任何写死的屏幕尺寸/位置。
- 旋转 / trait 变化时重新布局（`layoutSubviews` + `traitCollectionDidChange`）。
- 大屏、灵动岛、Home Indicator 安全区均通过 safeAreaInsets 覆盖。
- 设置面板窗口挂到前台 `UIWindowScene` 上（iOS 13+ 必须，否则可能不显示），关闭后恢复原 keyWindow。

## 搜索条 bug：18PM 上点按打不开（分析与修复）

原实现（AlipayLite 0x6760 + 0x71ec）机制：点搜索条 → 遍历 `[UIApplication windows]` 找 `isKeyWindow` → 从该窗口递归找搜索入口（HSearchTitleView / HSearchTextField 内的按钮，或类名含 Search / 标题含“搜索”的按钮）→ 触发 TouchUpInside → 震动。震动是无条件的，所以“点了有震动但打不开搜索”与“唤起逻辑静默失败”完全吻合。

疑似原因（**未实测定位，仅为假设，按可能性排序**）：

1. **keyWindow 找错**：`windows` + `isKeyWindow` 在 iOS 27 多 scene 下可能拿到错误窗口（或拿不到），递归从错误窗口出发自然找不到搜索入口。头号嫌疑。
2. **层级遮挡**：原实现只在建条时 `bringSubviewToFront` 一次，之后加进来的视图可能盖住搜索条，点按落到遮挡层上。
3. **几何/安全区错位**：原实现 y = H-92 写死；若 18PM 的安全区与 14PM 不同，搜索条可能错位到触摸不到的位置（可能性低于前两项——两机安全区大概率同为 34pt）。
4. **交互链**：搜索条或其父视图的 `userInteractionEnabled` 被改（可能性低）。
5. **版本层级差异**：用户支付宝版本的搜索入口类名/层级与原二进制所对版本不同（需脱壳 IPA 或真机日志核对）。
6. **时机**：唤起在点按时实时走树，时机问题可能性最低。

v1 改了什么：

- 搜索条 frame 改安全区感知（14PM 上与原值 H-92 完全一致，悬浮栏开启时叠在其上方）。
- 每次布局都更新 frame 并 `bringSubviewToFront`，且确认 `hidden=NO`、`alpha=1`、`userInteractionEnabled=YES` 全链路。
- keyWindow 查找改 scene 感知（前台激活 scene 的 keyWindow → 同 scene 内有 rootViewController 的 window → 旧接口回退 → 第一个 window）。
- 加备用唤起路径：keyWindow 唤起失败时，逐个前台 window 各试一次。
- 唤起结果打 NSLog（`[ZFBpay] 搜索唤起：成功/未找到搜索入口`），供诊断。
- 0x71ec 的触发逻辑（类名/标题匹配 + TouchUpInside）原样保留，未改动。

仍需真机实测：搜索条点按是否能打开搜索；若仍打不开，看日志确认是“未找到搜索入口”（层级/类差异）还是唤起成功但无反应（触发方式差异），再定下一步。

## TODO / 风险

- [ ] 首次 Actions 构建：Theos 安装、SDK 检测、substrate 链接、产物路径等均未经验证，见回报中的不确定项清单。
- [ ] 全部“重建实现”部分待真机验证（悬浮栏、面板、启动恢复、scene 感知唤起）。
- [ ] 悬浮栏挂载点取 tabBar.superview（近手册情况 B）；A/B 抉择无 TraceX 证据，若出现详情页/弹窗页底栏异常，需按手册 §4 重新判断。
- [ ] 悬浮栏与搜索条叠放是 v1 新设计（原二进制无悬浮栏），待真机确认观感。
- [ ] HMoreNavItemView 的 `dispatch_once` 只给第一个布局的实例加长按手势（忠实还原原实现）；若长按“+”无反应，首查此处。
- [ ] 角标只简单显示 `badgeValue`；手册 §7 的红点语义（颜色过滤、空串→红点、0→隐藏）未实现，待真机确认支付宝的角标行为。
- [ ] blur 用 SystemMaterial（自适应深浅色），手册写 SystemMaterialLight，待真机确认观感。
- [ ] 搜索钮放在胶囊右侧（手册未定左右），可调。
- [ ] 支付宝 bundleId `com.alipay.iphoneclient` 待用户核实（自检门与 filter plist 都用它）。
- [ ] 若支付宝版本更新导致私有类名/方法变化，对应钩子会静默跳过（日志有记录），需按新版本重新拆解。

## 文件清单

| 文件 | 说明 |
|---|---|
| `Tweak.m` | constructor + 18 个钩子 + 底部搜索条 |
| `ZFBHelpers.h` / `ZFBHelpers.m` | 内部 helper、健壮 keyWindow、搜索唤起总入口、启动恢复 |
| `ZFBFloatBar.h` / `ZFBFloatBar.m` | 磨砂悬浮底栏 |
| `ZFBSettings.h` / `ZFBSettings.m` | 开关存储（plist）、长按手势、设置面板 |
| `Makefile` / `control` / `ZFBpay.plist` | Theos 工程文件 |
| `.github/workflows/zfbpay.yml` | Actions 自动构建工作流 |

## 证据来源

- `AlipayLite.dylib` 反汇编报告（18 个钩子 + 内部 helper 函数体逐行实读，常量从 rodata 解出）
- FrostBar 悬浮底栏手册（donk 私人手稿 v2/v3）
- 酷安 / 高德 / 红果三成品拆解消化文
