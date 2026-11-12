//
//  Tweak.m
//  ZFBpay v1 —— 支付宝精简 + 悬浮底栏（AlipayLite 重建版）
//
//  证据来源（全部先读再写，无一编造）：
//    1. ~/workspace/tweak-dissection/AlipayLite.dylib.report.txt
//       AlipayLite.dylib 反汇编报告：ctor 0x6058，MSHookMessageEx ×16 +
//       class_addMethod ×2，替换函数体与内部 helper 逐行实读。
//    2. ~/workspace/frostbar/FrostBar吃透手册.md
//       悬浮底栏技术（藏原底栏、重建磨砂悬浮栏、启动恢复、情况 A/B）。
//    3. ~/workspace/frostbar/三成品拆解消化.md
//       酷安/高德的悬浮栏与设置面板做法、bundleId 自检门。
//
//  标注说明：
//    “已验证还原” = 反汇编函数体逐行实读，等价重写，含实测常量；
//    “重建实现”   = 按手册/分析重建，无二进制对照，待真机验证。
//
//  18 个钩子对照（地址 = AlipayLite.dylib 内替换函数地址）：
//    #  类                        方法                 地址    标注
//    1  LATabBar                  layoutSubviews       0x6344  已验证还原（搜索条几何重写为安全区感知，见下）
//    2  LATabBar                  setHidden:           0x6740  已验证还原（开关关闭时放行原值）
//    3  LATabBar                  setAlpha:            0x6750  已验证还原（开关关闭时放行原值）
//    4  LATabBar                  +handleBottomSearchTap: 0x6760 已验证还原（keyWindow 查找改 scene 感知 + 备用路径）
//    5  APHomeNaviView            layoutSubviews       0x68c8  已验证还原
//    6  HFNTabMainCollectionView  setFrame:            0x6a3c  已验证还原
//    7  HMoreNavItemView          layoutSubviews       0x6a5c  已验证还原
//    8  HMoreNavItemView          +handlePlusLongPress: 0x6ae0 已验证还原（keyWindow 查找改 scene 感知）
//    9  HFStreamingComponent      didMoveToSuperview  0x6da8  已验证还原
//    10 HFStreamingComponent      didMoveToWindow    0x6df4  已验证还原
//    11 HFStreamingComponent      layoutSubviews     0x6e40  已验证还原
//    12 HFStreamingComponent      setHidden:         0x6e8c  已验证还原
//    13 HFStreamingComponent      setAlpha:          0x6eec  已验证还原
//    14 HFMsgRemindCollectionViewCell layoutSubviews 0x6f54  已验证还原
//    15 HCommonUseView            layoutSubviews     0x6f80  已验证还原
//    16 APGFrontNativeHistoryCell layoutSubviews     0x6fcc  已验证还原
//    17 APGDynamicCardCell        layoutSubviews     0x7024  已验证还原
//    18 AUKView                   layoutSubviews     0x707c  已验证还原
//
//  内部 helper（ZFBHelpers.m）：0x71ec 搜索唤起、0x7530 找 Tab 控制器、
//  0x769c hideView、0x7714 isInsideClass、0x77a4 isInsideSearchVC，
//  全部已验证还原。
//
//  内存管理：ARC（Makefile 显式 -fobjc-arc）。手册 §10 写 MRC，但无
//  编译器可验，ARC 消除手动内存管理崩溃风险；原二进制疑似 MRC 与此无关。
//  无 @available（部署目标 iOS 15，全部 API 均已可用）；无 NSArray 下标。
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <objc/runtime.h>
#import <substrate.h>
#import "ZFBHelpers.h"
#import "ZFBFloatBar.h"
#import "ZFBSettings.h"

// ================= 原实现槽位 =================
static void (*orig_LATabBar_layoutSubviews)(id, SEL);
static void (*orig_LATabBar_setHidden)(id, SEL, BOOL);
static void (*orig_LATabBar_setAlpha)(id, SEL, CGFloat);
static void (*orig_APHomeNaviView_layoutSubviews)(id, SEL);
static void (*orig_HFNTabMainCollectionView_setFrame)(id, SEL, CGRect);
static void (*orig_HMoreNavItemView_layoutSubviews)(id, SEL);
static void (*orig_HFStreamingComponent_didMoveToSuperview)(id, SEL);
static void (*orig_HFStreamingComponent_didMoveToWindow)(id, SEL);
static void (*orig_HFStreamingComponent_layoutSubviews)(id, SEL);
static void (*orig_HFStreamingComponent_setHidden)(id, SEL, BOOL);
static void (*orig_HFStreamingComponent_setAlpha)(id, SEL, CGFloat);
static void (*orig_HFMsgRemindCollectionViewCell_layoutSubviews)(id, SEL);
static void (*orig_HCommonUseView_layoutSubviews)(id, SEL);
static void (*orig_APGFrontNativeHistoryCell_layoutSubviews)(id, SEL);
static void (*orig_APGDynamicCardCell_layoutSubviews)(id, SEL);
static void (*orig_AUKView_layoutSubviews)(id, SEL);

// ================= 底部搜索条（已验证还原 + 18PM 几何重写） =================
// 原实现（0x6344）只建一次、frame 写死 (16, H-92, W-32, 50)、只在建条时
// bringSubviewToFront 一次。重写保留全部已验证常量（高 50、边距 16、
// 背景 alpha 0.95、圆角 25、阴影 0.08/(0,3)/6、图标 (18,15,20,20)、
// 文字“搜索” 16pt 浅灰、label 宽 -90），但：
//   a) y 按 safeAreaInsets 实时计算（14PM 上与原值 H-92 完全一致）；
//   b) 悬浮栏开启时搜索条叠在其上方（间距 8），避免两者重叠；
//   c) 每次布局都更新 frame 并 bringSubviewToFront，保证最上层且可点。
// TODO：叠放位置是 v1 新设计（原二进制无悬浮栏），待真机确认观感。

static UIView *zfb_searchBarView = nil;
static const NSInteger kZFBSearchLabelTag = 1001;

static CGRect ZFBSearchBarFrame(UIView *superview) {
    CGRect bounds = [superview bounds];
    UIEdgeInsets safe = [superview safeAreaInsets];
    CGFloat margin = 16.0;
    CGFloat height = 50.0;
    CGFloat x = MAX(margin, safe.left);
    CGFloat right = MAX(margin, safe.right);
    CGFloat width = bounds.size.width - x - right;
    CGFloat bottomGap = 8.0;
    if ([ZFBSettings floatBarEnabled]) {
        bottomGap += 52.0 + 7.0 + 8.0; // 悬浮栏高 + 底边距 + 间距
    }
    CGFloat y = bounds.size.height - safe.bottom - height - bottomGap;
    return CGRectMake(x, y, width, height);
}

static void ZFBEnsureSearchBar(UIView *superview, id tabBarSelf) {
    if (zfb_searchBarView == nil) {
        UIView *bar = [[UIView alloc] initWithFrame:ZFBSearchBarFrame(superview)];
        [bar setBackgroundColor:[UIColor colorWithWhite:1.0 alpha:0.95]];
        [[bar layer] setCornerRadius:25.0];
        [[bar layer] setShadowColor:[[UIColor blackColor] CGColor]];
        [[bar layer] setShadowOpacity:0.08f];
        [[bar layer] setShadowOffset:CGSizeMake(0, 3)];
        [[bar layer] setShadowRadius:6.0];

        UIImageView *icon = [[UIImageView alloc] initWithImage:[UIImage systemImageNamed:@"magnifyingglass"]];
        [icon setTintColor:[UIColor grayColor]];
        [icon setFrame:CGRectMake(18, 15, 20, 20)];
        [bar addSubview:icon];

        UILabel *label = [[UILabel alloc] initWithFrame:CGRectMake(48, 0, [bar bounds].size.width - 90.0, 50.0)];
        [label setTag:kZFBSearchLabelTag];
        [label setText:@"搜索"];
        [label setTextColor:[UIColor lightGrayColor]];
        [label setFont:[UIFont systemFontOfSize:16.0]];
        [bar addSubview:label];

        UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc] initWithTarget:tabBarSelf action:sel_registerName("handleBottomSearchTap:")];
        [bar addGestureRecognizer:tap];

        zfb_searchBarView = bar;
    }
    // 每次布局：更新 frame、恢复可见与交互、确保最上层。
    [zfb_searchBarView setFrame:ZFBSearchBarFrame(superview)];
    [zfb_searchBarView setHidden:NO];
    [zfb_searchBarView setAlpha:1.0];
    [zfb_searchBarView setUserInteractionEnabled:YES];
    UILabel *label = (UILabel *)[zfb_searchBarView viewWithTag:kZFBSearchLabelTag];
    if (label != nil) {
        [label setFrame:CGRectMake(48, 0, [zfb_searchBarView bounds].size.width - 90.0, 50.0)];
    }
    if ([zfb_searchBarView superview] != superview) {
        [superview addSubview:zfb_searchBarView];
    }
    [superview bringSubviewToFront:zfb_searchBarView];
}

static void ZFBHideSearchBar(void) {
    if (zfb_searchBarView != nil) {
        [zfb_searchBarView setHidden:YES];
    }
}

// ================= 选中项变化追踪（供启动恢复保存） =================
static NSInteger zfb_lastSeenSelectedIndex = -2;

static void ZFBTrackSelectionChange(UITabBar *tabBar) {
    NSArray *items = [tabBar items];
    UITabBarItem *selected = [tabBar selectedItem];
    NSInteger index = -1;
    for (NSInteger i = 0; i < (NSInteger)[items count]; i++) {
        if ([items objectAtIndex:i] == selected) {
            index = i;
            break;
        }
    }
    if (index == zfb_lastSeenSelectedIndex) return;
    zfb_lastSeenSelectedIndex = index;
    if (index < 0) return;
    UIWindow *keyWindow = ZFBKeyWindow();
    UITabBarController *tbc = ZFBFindTabBarController([keyWindow rootViewController]);
    ZFBNoteTabBarSelection(index, tbc);
}

// ================= 1. LATabBar layoutSubviews（已验证还原 + 重建部分） =================
static BOOL zfb_wasFloatBarOn = NO;

static void ZFB_LATabBar_layoutSubviews(id self, SEL _cmd) {
    (void)_cmd;
    if (orig_LATabBar_layoutSubviews != NULL) {
        orig_LATabBar_layoutSubviews(self, @selector(layoutSubviews));
    }
    if (self == nil) return;
    if (![self isKindOfClass:[UITabBar class]]) return; // 已验证：原实现自检
    UITabBar *tabBar = (UITabBar *)self;

    BOOL floatBarOn = [ZFBSettings floatBarEnabled];
    if (floatBarOn) {
        // 已验证还原：藏原底栏（走 setHidden:/setAlpha: 钩子，幂等）。
        [tabBar setHidden:YES];
        [tabBar setAlpha:0.0];
    } else if (zfb_wasFloatBarOn) {
        // 开关刚从开切到关时恢复一次可见；之后把控制权还给 App 本身，
        // 避免每次布局强制可见而破坏 hidesBottomBarWhenPushed 等行为。
        if (orig_LATabBar_setHidden != NULL) {
            orig_LATabBar_setHidden(self, @selector(setHidden:), NO);
        }
        if (orig_LATabBar_setAlpha != NULL) {
            orig_LATabBar_setAlpha(self, @selector(setAlpha:), 1.0);
        }
    }
    zfb_wasFloatBarOn = floatBarOn;

    UIView *superview = [tabBar superview];
    if (superview == nil) return;
    [ZFBSettings noteTabBar:tabBar container:superview];

    if (floatBarOn) {
        // 重建实现：悬浮底栏安装/更新 + 选中态同步。
        ZFBFloatBar *bar = [ZFBFloatBar sharedBar];
        [bar zfb_installInContainer:superview tabBar:tabBar];
        [bar zfb_updateSelectionFromTabBar:tabBar];
    } else {
        [[ZFBFloatBar sharedBar] zfb_setBarHidden:YES];
    }

    if ([ZFBSettings searchBarEnabled]) {
        ZFBEnsureSearchBar(superview, self);
    } else {
        ZFBHideSearchBar();
    }

    // 重建实现：长按手势（只加一次）+ 启动恢复调度（只调度一次）。
    [ZFBSettings ensureLongPressGestureInContainer:superview];
    ZFBScheduleRestoreIfNeeded();
    ZFBTrackSelectionChange(tabBar);
}

// ================= 2. LATabBar setHidden:（已验证还原） =================
static void ZFB_LATabBar_setHidden(id self, SEL _cmd, BOOL hidden) {
    if ([ZFBSettings floatBarEnabled]) {
        hidden = YES; // 已验证：原实现强制 YES 后调原实现。
    }
    if (orig_LATabBar_setHidden != NULL) {
        orig_LATabBar_setHidden(self, _cmd, hidden);
    }
}

// ================= 3. LATabBar setAlpha:（已验证还原） =================
static void ZFB_LATabBar_setAlpha(id self, SEL _cmd, CGFloat alpha) {
    if ([ZFBSettings floatBarEnabled]) {
        alpha = 0.0; // 已验证：原实现强制 0 后调原实现。
    }
    if (orig_LATabBar_setAlpha != NULL) {
        orig_LATabBar_setAlpha(self, _cmd, alpha);
    }
}

// ================= 4. LATabBar handleBottomSearchTap:（已验证还原 + 健壮重写） =================
// 原实现：遍历 windows 找 isKeyWindow → 0x71ec 唤起 → 无条件震动。
// 重写：唤起逻辑（0x71ec）原样保留；keyWindow 查找改 scene 感知 + 备用
// 路径（ZFBTriggerSearch）；震动保留。疑似 18PM 失效原因与待实测项见 README。
static void ZFB_LATabBar_handleBottomSearchTap(id self, SEL _cmd, id sender) {
    (void)self;
    (void)_cmd;
    (void)sender;
    (void)ZFBTriggerSearch();
    ZFBHaptic();
}

// ================= 5. APHomeNaviView layoutSubviews（已验证还原） =================
// 原实现：调原实现后遍历 subviews，类名不包含 RightBarButtonsBox
// （大小写不敏感）的子视图一律 setAlpha:0——即只留 RightBarButtonsBox。
// 极性已逐行核对无误（未命中才隐藏），不要“修正”。
static void ZFB_APHomeNaviView_layoutSubviews(id self, SEL _cmd) {
    (void)_cmd;
    if (orig_APHomeNaviView_layoutSubviews != NULL) {
        orig_APHomeNaviView_layoutSubviews(self, @selector(layoutSubviews));
    }
    if (self == nil || ![ZFBSettings navPurifyEnabled]) return;
    for (UIView *sub in [(UIView *)self subviews]) {
        NSString *className = NSStringFromClass([sub class]);
        NSRange range = [className rangeOfString:@"RightBarButtonsBox" options:NSCaseInsensitiveSearch];
        if (range.location == NSNotFound) {
            [sub setAlpha:0.0];
        }
    }
}

// ================= 6. HFNTabMainCollectionView setFrame:（已验证还原） =================
// 原实现：frame.y > 20 则 y = 54，再调原实现。
static void ZFB_HFNTabMainCollectionView_setFrame(id self, SEL _cmd, CGRect frame) {
    if ([ZFBSettings navPurifyEnabled] && frame.origin.y > 20.0) {
        frame.origin.y = 54.0;
    }
    if (orig_HFNTabMainCollectionView_setFrame != NULL) {
        orig_HFNTabMainCollectionView_setFrame(self, _cmd, frame);
    }
}

// ================= 7. HMoreNavItemView layoutSubviews（已验证还原） =================
// 原实现：调原实现后 dispatch_once 加 UILongPressGestureRecognizer
// （0.5s，action handlePlusLongPress:）。注意原实现是全局 once，
// 只给第一个布局的实例加手势——此处忠实还原。
// TODO：若长按“+”无反应，首查此处 once 是否落在了非首页实例上。
static void ZFB_HMoreNavItemView_layoutSubviews(id self, SEL _cmd) {
    (void)_cmd;
    if (orig_HMoreNavItemView_layoutSubviews != NULL) {
        orig_HMoreNavItemView_layoutSubviews(self, @selector(layoutSubviews));
    }
    if (self == nil) return;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        UILongPressGestureRecognizer *gr = [[UILongPressGestureRecognizer alloc] initWithTarget:self action:sel_registerName("handlePlusLongPress:")];
        [gr setMinimumPressDuration:0.5];
        [(UIView *)self addGestureRecognizer:gr];
    });
}

// ================= 8. HMoreNavItemView handlePlusLongPress:（已验证还原） =================
// 原实现：state != Began 直接返回；找 Tab 控制器；取 selectedViewController
// （是导航则用它，否则用其 navigationController）；viewControllers >= 4 时
// push 第 4 个（下标 3），nav/target 为空时改 setSelectedIndex:3；最后震动。
// 唯一改动：keyWindow 查找改 scene 感知版（与搜索唤起同一理由）。
static void ZFB_HMoreNavItemView_handlePlusLongPress(id self, SEL _cmd, id sender) {
    (void)self;
    (void)_cmd;
    if ([(UIGestureRecognizer *)sender state] != UIGestureRecognizerStateBegan) return;
    UIWindow *keyWindow = ZFBKeyWindow();
    UITabBarController *tbc = ZFBFindTabBarController([keyWindow rootViewController]);
    if (tbc != nil) {
        UIViewController *selected = [tbc selectedViewController];
        UINavigationController *nav = nil;
        if ([selected isKindOfClass:[UINavigationController class]]) {
            nav = (UINavigationController *)selected;
        } else {
            nav = [selected navigationController];
        }
        NSArray *vcs = [tbc viewControllers];
        if ([vcs count] >= 4) {
            UIViewController *target = (UIViewController *)[vcs objectAtIndex:3];
            if (nav != nil && target != nil) {
                [[nav interactivePopGestureRecognizer] setEnabled:YES];
                [[nav interactivePopGestureRecognizer] setDelegate:nil];
                if ([nav topViewController] != target) {
                    [nav pushViewController:target animated:YES];
                }
            } else {
                [tbc setSelectedIndex:3];
            }
        }
    }
    ZFBHaptic();
}

// ================= 9-11. HFStreamingComponent（已验证还原） =================
// 原实现：调原实现；若身处 HFNTabPageScrollView 内则 hideView。
static void ZFB_HFStreamingComponent_didMoveToSuperview(id self, SEL _cmd) {
    (void)_cmd;
    if (orig_HFStreamingComponent_didMoveToSuperview != NULL) {
        orig_HFStreamingComponent_didMoveToSuperview(self, @selector(didMoveToSuperview));
    }
    if ([ZFBSettings feedBlockEnabled] && ZFBViewInsideClass((UIView *)self, @"HFNTabPageScrollView")) {
        ZFBHideView((UIView *)self);
    }
}

static void ZFB_HFStreamingComponent_didMoveToWindow(id self, SEL _cmd) {
    (void)_cmd;
    if (orig_HFStreamingComponent_didMoveToWindow != NULL) {
        orig_HFStreamingComponent_didMoveToWindow(self, @selector(didMoveToWindow));
    }
    if ([ZFBSettings feedBlockEnabled] && ZFBViewInsideClass((UIView *)self, @"HFNTabPageScrollView")) {
        ZFBHideView((UIView *)self);
    }
}

static void ZFB_HFStreamingComponent_layoutSubviews(id self, SEL _cmd) {
    (void)_cmd;
    if (orig_HFStreamingComponent_layoutSubviews != NULL) {
        orig_HFStreamingComponent_layoutSubviews(self, @selector(layoutSubviews));
    }
    if ([ZFBSettings feedBlockEnabled] && ZFBViewInsideClass((UIView *)self, @"HFNTabPageScrollView")) {
        ZFBHideView((UIView *)self);
    }
}

// ================= 12. HFStreamingComponent setHidden:（已验证还原） =================
// 原实现：hidden = 传入值 OR 身处 HFNTabPageScrollView 内，再调原实现。
static void ZFB_HFStreamingComponent_setHidden(id self, SEL _cmd, BOOL hidden) {
    if ([ZFBSettings feedBlockEnabled] && ZFBViewInsideClass((UIView *)self, @"HFNTabPageScrollView")) {
        hidden = YES;
    }
    if (orig_HFStreamingComponent_setHidden != NULL) {
        orig_HFStreamingComponent_setHidden(self, _cmd, hidden);
    }
}

// ================= 13. HFStreamingComponent setAlpha:（已验证还原） =================
// 原实现：身处 HFNTabPageScrollView 内则 alpha = 0，再调原实现。
static void ZFB_HFStreamingComponent_setAlpha(id self, SEL _cmd, CGFloat alpha) {
    if ([ZFBSettings feedBlockEnabled] && ZFBViewInsideClass((UIView *)self, @"HFNTabPageScrollView")) {
        alpha = 0.0;
    }
    if (orig_HFStreamingComponent_setAlpha != NULL) {
        orig_HFStreamingComponent_setAlpha(self, _cmd, alpha);
    }
}

// ================= 14. HFMsgRemindCollectionViewCell layoutSubviews（已验证还原） =================
// 原实现：调原实现后无条件 hideView。
static void ZFB_HFMsgRemindCollectionViewCell_layoutSubviews(id self, SEL _cmd) {
    (void)_cmd;
    if (orig_HFMsgRemindCollectionViewCell_layoutSubviews != NULL) {
        orig_HFMsgRemindCollectionViewCell_layoutSubviews(self, @selector(layoutSubviews));
    }
    if ([ZFBSettings cardPurifyEnabled]) {
        ZFBHideView((UIView *)self);
    }
}

// ================= 15. HCommonUseView layoutSubviews（已验证还原） =================
// 原实现：调原实现；若身处 HFNTabMainCollectionView 内则 hideView。
static void ZFB_HCommonUseView_layoutSubviews(id self, SEL _cmd) {
    (void)_cmd;
    if (orig_HCommonUseView_layoutSubviews != NULL) {
        orig_HCommonUseView_layoutSubviews(self, @selector(layoutSubviews));
    }
    if ([ZFBSettings cardPurifyEnabled] && ZFBViewInsideClass((UIView *)self, @"HFNTabMainCollectionView")) {
        ZFBHideView((UIView *)self);
    }
}

// ================= 16-17. 历史/动态卡片 cell layoutSubviews（已验证还原） =================
// 原实现：调原实现；若身处 APGDynamicTableView 内且身处搜索 VC 内则 hideView。
static void ZFB_APGFrontNativeHistoryCell_layoutSubviews(id self, SEL _cmd) {
    (void)_cmd;
    if (orig_APGFrontNativeHistoryCell_layoutSubviews != NULL) {
        orig_APGFrontNativeHistoryCell_layoutSubviews(self, @selector(layoutSubviews));
    }
    if ([ZFBSettings cardPurifyEnabled] &&
        ZFBViewInsideClass((UIView *)self, @"APGDynamicTableView") &&
        ZFBViewInsideSearchVC((UIView *)self)) {
        ZFBHideView((UIView *)self);
    }
}

static void ZFB_APGDynamicCardCell_layoutSubviews(id self, SEL _cmd) {
    (void)_cmd;
    if (orig_APGDynamicCardCell_layoutSubviews != NULL) {
        orig_APGDynamicCardCell_layoutSubviews(self, @selector(layoutSubviews));
    }
    if ([ZFBSettings cardPurifyEnabled] &&
        ZFBViewInsideClass((UIView *)self, @"APGDynamicTableView") &&
        ZFBViewInsideSearchVC((UIView *)self)) {
        ZFBHideView((UIView *)self);
    }
}

// ================= 18. AUKView layoutSubviews（已验证还原） =================
// 原实现：调原实现；若有 window 且身处搜索 VC 内，自身在 window 中的
// y >= window 高 × 0.7 且自身宽 <= 220、高 <= 90 时，沿 superview 上爬
// （祖先宽 <= 360 且高 <= 140 才继续），hideView 最外层符合的小祖先。
// 常量 0.7 / 220 / 90 / 360 / 140 全部从二进制 rodata 实测解出。
static void ZFB_AUKView_layoutSubviews(id self, SEL _cmd) {
    (void)_cmd;
    if (orig_AUKView_layoutSubviews != NULL) {
        orig_AUKView_layoutSubviews(self, @selector(layoutSubviews));
    }
    if (self == nil || ![ZFBSettings cardPurifyEnabled]) return;
    UIView *view = (UIView *)self;
    UIWindow *window = [view window];
    if (window == nil) return;
    if (!ZFBViewInsideSearchVC(view)) return;
    CGRect rect = [view convertRect:[view bounds] toView:window];
    CGFloat windowHeight = CGRectGetHeight([window bounds]);
    if (rect.origin.y < windowHeight * 0.7) return;
    if (CGRectGetWidth([view bounds]) > 220.0) return;
    if (CGRectGetHeight([view bounds]) > 90.0) return;
    UIView *target = view;
    UIView *parent = [target superview];
    while (parent != nil) {
        CGRect parentBounds = [parent bounds];
        if (parentBounds.size.width > 360.0 || parentBounds.size.height > 140.0) break;
        target = parent;
        parent = [target superview];
    }
    ZFBHideView(target);
}

// ================= constructor：自检门 + 安装 18 个钩子 =================
// 自检门仿酷安（ctor 先验 bundleId）。支付宝 bundleId 标注如下：
// TODO：com.alipay.iphoneclient 待用户核实（勿断言）。
__attribute__((constructor)) static void ZFBInit(void) {
    NSString *bundleID = [[NSBundle mainBundle] bundleIdentifier];
    if (bundleID == nil || ![bundleID isEqualToString:@"com.alipay.iphoneclient"]) {
        return;
    }
    NSLog(@"[ZFBpay] v1 已加载，bundle=%@", bundleID);

    Class cls = objc_getClass("LATabBar");
    if (cls != nil) {
        MSHookMessageEx(cls, @selector(layoutSubviews), (IMP)ZFB_LATabBar_layoutSubviews, (IMP *)&orig_LATabBar_layoutSubviews);
        MSHookMessageEx(cls, @selector(setHidden:), (IMP)ZFB_LATabBar_setHidden, (IMP *)&orig_LATabBar_setHidden);
        MSHookMessageEx(cls, @selector(setAlpha:), (IMP)ZFB_LATabBar_setAlpha, (IMP *)&orig_LATabBar_setAlpha);
        class_addMethod(cls, sel_registerName("handleBottomSearchTap:"), (IMP)ZFB_LATabBar_handleBottomSearchTap, "v@:@");
    } else {
        NSLog(@"[ZFBpay] 未找到类 LATabBar，跳过相关 hook");
    }

    cls = objc_getClass("APHomeNaviView");
    if (cls != nil) {
        MSHookMessageEx(cls, @selector(layoutSubviews), (IMP)ZFB_APHomeNaviView_layoutSubviews, (IMP *)&orig_APHomeNaviView_layoutSubviews);
    } else {
        NSLog(@"[ZFBpay] 未找到类 APHomeNaviView，跳过相关 hook");
    }

    cls = objc_getClass("HFNTabMainCollectionView");
    if (cls != nil) {
        MSHookMessageEx(cls, @selector(setFrame:), (IMP)ZFB_HFNTabMainCollectionView_setFrame, (IMP *)&orig_HFNTabMainCollectionView_setFrame);
    } else {
        NSLog(@"[ZFBpay] 未找到类 HFNTabMainCollectionView，跳过相关 hook");
    }

    cls = objc_getClass("HMoreNavItemView");
    if (cls != nil) {
        MSHookMessageEx(cls, @selector(layoutSubviews), (IMP)ZFB_HMoreNavItemView_layoutSubviews, (IMP *)&orig_HMoreNavItemView_layoutSubviews);
        class_addMethod(cls, sel_registerName("handlePlusLongPress:"), (IMP)ZFB_HMoreNavItemView_handlePlusLongPress, "v@:@");
    } else {
        NSLog(@"[ZFBpay] 未找到类 HMoreNavItemView，跳过相关 hook");
    }

    cls = objc_getClass("HFStreamingComponent");
    if (cls != nil) {
        MSHookMessageEx(cls, @selector(didMoveToSuperview), (IMP)ZFB_HFStreamingComponent_didMoveToSuperview, (IMP *)&orig_HFStreamingComponent_didMoveToSuperview);
        MSHookMessageEx(cls, @selector(didMoveToWindow), (IMP)ZFB_HFStreamingComponent_didMoveToWindow, (IMP *)&orig_HFStreamingComponent_didMoveToWindow);
        MSHookMessageEx(cls, @selector(layoutSubviews), (IMP)ZFB_HFStreamingComponent_layoutSubviews, (IMP *)&orig_HFStreamingComponent_layoutSubviews);
        MSHookMessageEx(cls, @selector(setHidden:), (IMP)ZFB_HFStreamingComponent_setHidden, (IMP *)&orig_HFStreamingComponent_setHidden);
        MSHookMessageEx(cls, @selector(setAlpha:), (IMP)ZFB_HFStreamingComponent_setAlpha, (IMP *)&orig_HFStreamingComponent_setAlpha);
    } else {
        NSLog(@"[ZFBpay] 未找到类 HFStreamingComponent，跳过相关 hook");
    }

    cls = objc_getClass("HFMsgRemindCollectionViewCell");
    if (cls != nil) {
        MSHookMessageEx(cls, @selector(layoutSubviews), (IMP)ZFB_HFMsgRemindCollectionViewCell_layoutSubviews, (IMP *)&orig_HFMsgRemindCollectionViewCell_layoutSubviews);
    } else {
        NSLog(@"[ZFBpay] 未找到类 HFMsgRemindCollectionViewCell，跳过相关 hook");
    }

    cls = objc_getClass("HCommonUseView");
    if (cls != nil) {
        MSHookMessageEx(cls, @selector(layoutSubviews), (IMP)ZFB_HCommonUseView_layoutSubviews, (IMP *)&orig_HCommonUseView_layoutSubviews);
    } else {
        NSLog(@"[ZFBpay] 未找到类 HCommonUseView，跳过相关 hook");
    }

    cls = objc_getClass("APGFrontNativeHistoryCell");
    if (cls != nil) {
        MSHookMessageEx(cls, @selector(layoutSubviews), (IMP)ZFB_APGFrontNativeHistoryCell_layoutSubviews, (IMP *)&orig_APGFrontNativeHistoryCell_layoutSubviews);
    } else {
        NSLog(@"[ZFBpay] 未找到类 APGFrontNativeHistoryCell，跳过相关 hook");
    }

    cls = objc_getClass("APGDynamicCardCell");
    if (cls != nil) {
        MSHookMessageEx(cls, @selector(layoutSubviews), (IMP)ZFB_APGDynamicCardCell_layoutSubviews, (IMP *)&orig_APGDynamicCardCell_layoutSubviews);
    } else {
        NSLog(@"[ZFBpay] 未找到类 APGDynamicCardCell，跳过相关 hook");
    }

    cls = objc_getClass("AUKView");
    if (cls != nil) {
        MSHookMessageEx(cls, @selector(layoutSubviews), (IMP)ZFB_AUKView_layoutSubviews, (IMP *)&orig_AUKView_layoutSubviews);
    } else {
        NSLog(@"[ZFBpay] 未找到类 AUKView，跳过相关 hook");
    }
}
