//
//  ZFBFloatBar.h
//  ZFBpay v1 —— 磨砂悬浮底栏
//
//  重建实现（待真机验证）：按 FrostBar 手册 §3/§4/§5 技术重建。
//  Tab 按钮动态取自原 tabBar 的 items（数量、标题、图标、角标），
//  不硬编码。布局全部按容器实时 bounds + safeAreaInsets 计算。
//

#import <UIKit/UIKit.h>

@interface ZFBFloatBar : UIView

// 单例：一次创建常驻（手册 §5）。
+ (instancetype)sharedBar;

// 安装/更新：挂到 tabBar 所在容器，重算自适应 frame，置于最上层。
// items 变化时重建按钮；每次调用都刷新 frame（旋转/安全区变化时自适应）。
- (void)zfb_installInContainer:(UIView *)container tabBar:(UITabBar *)tabBar;

// 按原 tabBar 的 selectedItem 同步选中态与角标。
- (void)zfb_updateSelectionFromTabBar:(UITabBar *)tabBar;

// 隐藏/显示（开关关闭时隐藏，实例保留以便重新打开）。
- (void)zfb_setBarHidden:(BOOL)hidden;

@end
