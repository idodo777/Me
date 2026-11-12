//
//  ZFBHelpers.m
//  ZFBpay v1 —— 共享内部 helper 实现
//
//  标注说明：
//    “已验证还原” = AlipayLite 反汇编函数体逐行实读后等价重写；
//    “重建实现”   = 按手册/分析重建，无二进制对照，待真机验证。
//

#import "ZFBHelpers.h"
#import "ZFBSettings.h"

// ================= 已验证还原：0x769c hideView =================
void ZFBHideView(UIView *view) {
    if (view == nil) return;
    [view setHidden:YES];
    [view setAlpha:0.0];
    [view setUserInteractionEnabled:NO];
    [[view layer] setShadowOpacity:0.0f];
}

// ================= 已验证还原：0x7714 isInsideClass =================
BOOL ZFBViewInsideClass(UIView *view, NSString *className) {
    UIView *cursor = view;
    while (cursor != nil) {
        NSString *name = NSStringFromClass([cursor class]);
        if ([name isEqualToString:className]) return YES;
        cursor = [cursor superview];
    }
    return NO;
}

// ================= 已验证还原：0x77a4 isInsideSearchVC =================
BOOL ZFBViewInsideSearchVC(UIView *view) {
    UIResponder *cursor = view;
    while (cursor != nil) {
        NSString *name = NSStringFromClass([cursor class]);
        if ([name isEqualToString:@"APGSearchMainViewController"]) return YES;
        cursor = [cursor nextResponder];
    }
    return NO;
}

// ================= 已验证还原：0x7530 findTabBarController =================
UITabBarController *ZFBFindTabBarController(UIViewController *vc) {
    if (vc == nil) return nil;
    if ([vc isKindOfClass:[UITabBarController class]]) {
        return (UITabBarController *)vc;
    }
    UITabBarController *found = ZFBFindTabBarController([vc presentedViewController]);
    if (found != nil) return found;
    for (UIViewController *child in [vc childViewControllers]) {
        found = ZFBFindTabBarController(child);
        if (found != nil) return found;
    }
    return nil;
}

// ================= 已验证还原：0x71ec 搜索唤起 =================
BOOL ZFBTriggerSearchFromView(UIView *view) {
    if (view == nil) return NO;
    NSString *className = NSStringFromClass([view class]);
    if ([className isEqualToString:@"HSearchTitleView"] ||
        [className isEqualToString:@"HSearchTextField"]) {
        for (UIView *sub in [view subviews]) {
            if ([sub isKindOfClass:[UIButton class]]) {
                UIButton *button = (UIButton *)sub;
                [button sendActionsForControlEvents:UIControlEventTouchUpInside];
                return YES;
            }
        }
    }
    if ([view isKindOfClass:[UIButton class]]) {
        UIButton *button = (UIButton *)view;
        NSString *title = [button currentTitle];
        NSRange range = [className rangeOfString:@"Search" options:NSCaseInsensitiveSearch];
        BOOL titleMatch = (title != nil && [title containsString:@"搜索"]);
        if (range.location != NSNotFound || titleMatch) {
            [button sendActionsForControlEvents:UIControlEventTouchUpInside];
            return YES;
        }
    }
    for (UIView *sub in [view subviews]) {
        if (ZFBTriggerSearchFromView(sub)) return YES;
    }
    return NO;
}

// ================= 重建实现：scene 感知 keyWindow =================
// 原实现只遍历 [UIApplication windows] 找 isKeyWindow。在 iOS 27 多 scene 下
// 可能拿到错误窗口（或拿不到），导致搜索唤起静默失败——这是 18PM 上
// “点搜索条打不开”的头号嫌疑（未实测定位，仅为假设，见 README）。
// 本重建保留旧接口作为回退，不改变 14PM 上已验证的行为。
UIWindow *ZFBKeyWindow(void) {
    UIApplication *app = [UIApplication sharedApplication];
    if ([app respondsToSelector:@selector(connectedScenes)]) {
        NSSet *scenes = [app connectedScenes];
        for (UIScene *scene in scenes) {
            if ([scene activationState] != UISceneActivationStateForegroundActive) continue;
            if (![scene isKindOfClass:[UIWindowScene class]]) continue;
            UIWindowScene *windowScene = (UIWindowScene *)scene;
            for (UIWindow *window in [windowScene windows]) {
                if ([window isKeyWindow]) return window;
            }
        }
        for (UIScene *scene in scenes) {
            if ([scene activationState] != UISceneActivationStateForegroundActive) continue;
            if (![scene isKindOfClass:[UIWindowScene class]]) continue;
            UIWindowScene *windowScene = (UIWindowScene *)scene;
            for (UIWindow *window in [windowScene windows]) {
                if ([window rootViewController] != nil) return window;
            }
        }
    }
    for (UIWindow *window in [app windows]) {
        if ([window isKeyWindow]) return window;
    }
    NSArray *windows = [app windows];
    if ([windows count] > 0) {
        return (UIWindow *)[windows objectAtIndex:0];
    }
    return nil;
}

NSArray<UIWindow *> *ZFBAllForegroundWindows(void) {
    NSMutableArray<UIWindow *> *result = [NSMutableArray array];
    UIApplication *app = [UIApplication sharedApplication];
    if ([app respondsToSelector:@selector(connectedScenes)]) {
        for (UIScene *scene in [app connectedScenes]) {
            if ([scene activationState] != UISceneActivationStateForegroundActive) continue;
            if (![scene isKindOfClass:[UIWindowScene class]]) continue;
            for (UIWindow *window in [(UIWindowScene *)scene windows]) {
                if (![result containsObject:window]) [result addObject:window];
            }
        }
    }
    for (UIWindow *window in [app windows]) {
        if (![result containsObject:window]) [result addObject:window];
    }
    return result;
}

// ================= 重建实现：搜索唤起总入口（含备用路径） =================
BOOL ZFBTriggerSearch(void) {
    BOOL triggered = NO;
    UIWindow *keyWindow = ZFBKeyWindow();
    if (keyWindow != nil) {
        triggered = ZFBTriggerSearchFromView(keyWindow);
    }
    if (!triggered) {
        // 备用路径：逐个前台 window 各试一次（keyWindow 找错时兜底）。
        for (UIWindow *window in ZFBAllForegroundWindows()) {
            if (window == keyWindow) continue;
            if (ZFBTriggerSearchFromView(window)) {
                triggered = YES;
                break;
            }
        }
    }
    NSLog(@"[ZFBpay] 搜索唤起：%@", triggered ? @"成功" : @"未找到搜索入口");
    return triggered;
}

// ================= 已验证还原：0x6760 末尾的震动 =================
void ZFBHaptic(void) {
    // 原实现：UIImpactFeedbackGenerator initWithStyle:0 + impactOccurred。
    // style 0 = UIImpactFeedbackStyleLight。
    UIImpactFeedbackGenerator *generator = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleLight];
    [generator impactOccurred];
}

// ================= 重建实现：启动恢复（手册 §11） =================
static BOOL zfb_restoreScheduled = NO;
static BOOL zfb_restoreDone = NO;
static BOOL zfb_userChoseTab = NO;
static BOOL zfb_readyToSave = NO;
static BOOL zfb_restoring = NO;
static NSInteger zfb_restoreAttempts = 0;

NSString *ZFBOrderSignature(NSArray *viewControllers) {
    NSMutableArray *names = [NSMutableArray array];
    for (id vc in viewControllers) {
        id target = vc;
        if ([vc isKindOfClass:[UINavigationController class]]) {
            NSArray *stack = [(UINavigationController *)vc viewControllers];
            if ([stack count] > 0) {
                target = [stack objectAtIndex:0];
            }
        }
        [names addObject:NSStringFromClass([target class])];
    }
    return [names componentsJoinedByString:@","];
}

static void ZFBAttemptRestore(void) {
    if (zfb_restoreDone || zfb_userChoseTab) {
        zfb_restoreDone = YES;
        zfb_readyToSave = YES;
        return;
    }
    UIWindow *keyWindow = ZFBKeyWindow();
    UITabBarController *tbc = ZFBFindTabBarController([keyWindow rootViewController]);
    NSArray *vcs = (tbc != nil) ? [tbc viewControllers] : nil;
    if (tbc == nil || [vcs count] == 0) {
        zfb_restoreAttempts += 1;
        if (zfb_restoreAttempts <= 8) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.25 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                ZFBAttemptRestore();
            });
        } else {
            zfb_restoreDone = YES;
            zfb_readyToSave = YES;
        }
        return;
    }
    NSNumber *saved = [ZFBSettings lastTabIndex];
    NSString *savedSignature = [ZFBSettings lastTabSignature];
    NSString *signature = ZFBOrderSignature(vcs);
    NSInteger index = -1;
    if (saved != nil && savedSignature != nil && [signature isEqualToString:savedSignature]) {
        index = [saved integerValue];
        if (index < 0 || index >= (NSInteger)[vcs count]) index = -1;
    }
    if (index < 0) index = 0; // 无记录 / 越界 / 顺序变化 → 首个 Tab。
    zfb_restoring = YES;
    [tbc setSelectedIndex:index];
    zfb_restoring = NO;
    zfb_restoreDone = YES;
    zfb_readyToSave = YES;
}

void ZFBScheduleRestoreIfNeeded(void) {
    if (zfb_restoreScheduled || zfb_restoreDone) return;
    zfb_restoreScheduled = YES;
    if (![ZFBSettings restoreTabEnabled]) {
        zfb_restoreDone = YES;
        zfb_readyToSave = YES;
        return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.4 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        ZFBAttemptRestore();
    });
}

void ZFBNoteUserChoseTab(void) {
    zfb_userChoseTab = YES;
    zfb_readyToSave = YES;
}

void ZFBNoteTabBarSelection(NSInteger selectedIndex, UITabBarController *tbc) {
    if (![ZFBSettings restoreTabEnabled]) return;
    if (!zfb_readyToSave || zfb_restoring) return;
    if (tbc == nil) return;
    NSArray *vcs = [tbc viewControllers];
    if (selectedIndex < 0 || selectedIndex >= (NSInteger)[vcs count]) return;
    [ZFBSettings saveLastTabIndex:selectedIndex signature:ZFBOrderSignature(vcs)];
}
