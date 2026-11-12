//
//  ZFBSettings.h
//  ZFBpay v1 —— 开关存储 + 长按设置面板
//
//  重建实现（待真机验证）：参考红果 HGPanel（自有 UIWindow + 卡片 +
//  表格）与酷安 KASettingsManager 的做法。开关持久化到 Documents 下的
//  ZFBpay.plist，默认全开，改动即时生效（触发一次 tabBar 布局）。
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

@interface ZFBSettings : NSObject

// ---------- 六个功能开关（默认全开） ----------
+ (BOOL)floatBarEnabled;   // 悬浮底栏（关 = 恢复原底栏）
+ (BOOL)searchBarEnabled;  // 底部搜索条
+ (BOOL)feedBlockEnabled;  // 信息流屏蔽
+ (BOOL)cardPurifyEnabled; // 卡片净化
+ (BOOL)navPurifyEnabled;  // 顶部导航净化
+ (BOOL)restoreTabEnabled; // 启动恢复上次 Tab

+ (void)setFloatBarEnabled:(BOOL)enabled;
+ (void)setSearchBarEnabled:(BOOL)enabled;
+ (void)setFeedBlockEnabled:(BOOL)enabled;
+ (void)setCardPurifyEnabled:(BOOL)enabled;
+ (void)setNavPurifyEnabled:(BOOL)enabled;
+ (void)setRestoreTabEnabled:(BOOL)enabled;

// ---------- 启动恢复的持久化 ----------
+ (NSNumber * _Nullable)lastTabIndex; // 从未保存过返回 nil（须与 0 区分）
+ (NSString * _Nullable)lastTabSignature;
+ (void)saveLastTabIndex:(NSInteger)index signature:(NSString *)signature;

// ---------- 与 hook 层的协作 ----------
// 记住 tabBar 与容器（弱引用），供开关改动后强制重新布局。
+ (void)noteTabBar:(UITabBar * _Nullable)tabBar container:(UIView * _Nullable)container;
// 开关改动后立即生效：强制 tabBar 重新布局（钩子每次布局都重读开关）。
+ (void)applySettingsChange;

// ---------- 设置面板 ----------
// 长按手势挂在 tabBar 所在容器上（触发区在悬浮底栏隐藏后仍然存在）。
+ (void)ensureLongPressGestureInContainer:(UIView *)container;
+ (void)showPanel;
+ (void)hidePanel;

@end
