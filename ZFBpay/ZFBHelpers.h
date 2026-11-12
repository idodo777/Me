//
//  ZFBHelpers.h
//  ZFBpay v1 —— 共享内部 helper
//
//  证据来源：~/workspace/tweak-dissection/AlipayLite.dylib.report.txt
//  （AlipayLite.dylib 反汇编报告，函数体逐行实读，地址见下方注释）
//
//  本文件不声明任何支付宝私有类；私有类名只以字符串形式出现，
//  由 objc_getClass / NSStringFromClass 在运行时比对。
//  没有任何类名、方法名、选择子是凭空编造的。
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

// ---------- 已验证还原：AlipayLite 内部 helper ----------

// 0x769c：隐藏视图（hidden + alpha 0 + 关闭交互 + 阴影归零）。
void ZFBHideView(UIView * _Nullable view);

// 0x7714：沿 view + superview 链，类名是否等于 className。
BOOL ZFBViewInsideClass(UIView * _Nullable view, NSString *className);

// 0x77a4：沿 view + nextResponder 链，是否身处 APGSearchMainViewController。
BOOL ZFBViewInsideSearchVC(UIView * _Nullable view);

// 0x7530：递归找 UITabBarController（自身 → presented → children）。
UITabBarController * _Nullable ZFBFindTabBarController(UIViewController * _Nullable vc);

// 0x71ec：递归找搜索入口并触发。
//   命中 HSearchTitleView / HSearchTextField 时点其第一个 UIButton 子视图；
//   自身是 UIButton 且类名含 Search 或标题含“搜索”时点自身；
//   否则递归子视图。成功返回 YES。
BOOL ZFBTriggerSearchFromView(UIView * _Nullable view);

// ---------- 重建：健壮的搜索唤起与 keyWindow（修 18PM 搜索打不开） ----------

// scene 感知找 keyWindow：前台激活 scene 的 keyWindow → 同 scene 内有
// rootViewController 的 window → 旧接口 windows 遍历 → 第一个 window。
UIWindow * _Nullable ZFBKeyWindow(void);

// 前台 scene 的全部 window（去重，含旧接口回退），供备用唤起路径遍历。
NSArray<UIWindow *> *ZFBAllForegroundWindows(void);

// 搜索唤起总入口：先走 keyWindow，失败再逐个 window 尝试。成功返回 YES。
BOOL ZFBTriggerSearch(void);

// 轻震动（已验证还原：UIImpactFeedbackGenerator style 0 + impactOccurred）。
void ZFBHaptic(void);

// ---------- 重建：启动恢复（FrostBar 手册 §11 三态机，简化版） ----------

// 首次布局时调度一次：延迟 0.4s 后尝试恢复上次 Tab，失败有界重试 8 次 × 0.25s。
void ZFBScheduleRestoreIfNeeded(void);

// 用户主动点了悬浮栏 Tab：取消待恢复，并开放保存。
void ZFBNoteUserChoseTab(void);

// 选中项变化时调用：就绪后把 (index, 顺序签名) 存入 plist。
void ZFBNoteTabBarSelection(NSInteger selectedIndex, UITabBarController * _Nullable tbc);

// 顺序签名：官方顺序中各根控制器类名（导航包装先解包到栈底），逗号连接。
NSString *ZFBOrderSignature(NSArray *viewControllers);

NS_ASSUME_NONNULL_END
