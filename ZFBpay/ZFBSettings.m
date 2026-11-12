//
//  ZFBSettings.m
//  ZFBpay v1 —— 开关存储 + 长按设置面板实现
//
//  重建实现（待真机验证）。
//
//  长按触发区设计（边界处理）：
//    手势挂在 tabBar 所在容器上（不是悬浮栏本身），只加一次。
//    悬浮栏显示时，触发区 = 悬浮栏 frame（放宽 8pt），避免误触首页内容；
//    悬浮栏隐藏（开关关闭）时，触发区 = 底部 120pt + 安全区，
//    这样用户关掉悬浮栏后仍能长按底部把面板呼出来重新打开。
//    cancelsTouchesInView = NO，不吞正常点按。
//

#import "ZFBSettings.h"
#import "ZFBHelpers.h"
#import "ZFBFloatBar.h"
#import <objc/runtime.h>

static NSString *const kZFBPlistName = @"ZFBpay.plist";
static NSString *const kKeyFloatBar = @"zfbpay_floatbar";
static NSString *const kKeySearchBar = @"zfbpay_searchbar";
static NSString *const kKeyFeedBlock = @"zfbpay_feedblock";
static NSString *const kKeyCardPurify = @"zfbpay_cardpurify";
static NSString *const kKeyNavPurify = @"zfbpay_navpurify";
static NSString *const kKeyRestoreTab = @"zfbpay_restore_tab";

static NSMutableDictionary *zfb_store = nil;
static __weak UITabBar *zfb_knownTabBar = nil;
static __weak UIView *zfb_knownContainer = nil;
static char kZFBLongPressKey;

static UIWindow *zfb_panelWindow = nil;
static UIWindow *zfb_previousKeyWindow = nil;
static BOOL zfb_panelShowing = NO;

// 开关行定义：key / 标题 / 副标题。
typedef struct {
    const char *key;
    const char *title;
    const char *subtitle;
} ZFBSwitchRow;

static const ZFBSwitchRow zfb_rows[] = {
    {"zfbpay_floatbar", "悬浮底栏", "显示磨砂悬浮底栏，关闭则恢复原底栏"},
    {"zfbpay_searchbar", "底部搜索条", "显示底部搜索条"},
    {"zfbpay_feedblock", "信息流屏蔽", "屏蔽首页信息流"},
    {"zfbpay_cardpurify", "卡片净化", "净化提醒卡片与历史、动态卡片"},
    {"zfbpay_navpurify", "顶部导航净化", "隐藏顶部导航多余内容并调整首页布局"},
    {"zfbpay_restore_tab", "启动恢复上次 Tab", "启动时回到上次停留的 Tab"},
};
static const NSInteger zfb_rowCount = 6;

#pragma mark - 表格控制器

@interface ZFBSettings ()
+ (BOOL)zfb_boolForKey:(NSString *)key;
+ (void)zfb_setBool:(BOOL)enabled forKey:(NSString *)key;
+ (void)zfb_handleLongPress:(UILongPressGestureRecognizer *)gr;
@end

@interface ZFBSettingsTableViewController : UITableViewController
- (void)zfb_switchChanged:(UISwitch *)sender;
@end

@implementation ZFBSettingsTableViewController

- (NSInteger)numberOfSectionsInTableView:(UITableView *)tableView {
    (void)tableView;
    return 1;
}

- (NSInteger)tableView:(UITableView *)tableView numberOfRowsInSection:(NSInteger)section {
    (void)tableView;
    (void)section;
    return zfb_rowCount;
}

- (NSString *)tableView:(UITableView *)tableView titleForHeaderInSection:(NSInteger)section {
    (void)tableView;
    (void)section;
    return @"功能开关（开 = 启用）";
}

- (NSString *)tableView:(UITableView *)tableView titleForFooterInSection:(NSInteger)section {
    (void)tableView;
    (void)section;
    return @"ZFBpay v1 · 长按底部呼出面板";
}

- (UITableViewCell *)tableView:(UITableView *)tableView cellForRowAtIndexPath:(NSIndexPath *)indexPath {
    static NSString *cellID = @"ZFBSwitchCell";
    UITableViewCell *cell = [tableView dequeueReusableCellWithIdentifier:cellID];
    if (cell == nil) {
        cell = [[UITableViewCell alloc] initWithStyle:UITableViewCellStyleSubtitle reuseIdentifier:cellID];
    }
    NSInteger row = [indexPath row];
    NSString *key = [NSString stringWithUTF8String:zfb_rows[row].key];
    NSString *title = [NSString stringWithUTF8String:zfb_rows[row].title];
    NSString *subtitle = [NSString stringWithUTF8String:zfb_rows[row].subtitle];
    [[cell textLabel] setText:title];
    [[cell detailTextLabel] setText:subtitle];
    [cell setSelectionStyle:UITableViewCellSelectionStyleNone];

    UISwitch *toggle = (UISwitch *)[cell accessoryView];
    if (toggle == nil || ![toggle isKindOfClass:[UISwitch class]]) {
        toggle = [[UISwitch alloc] initWithFrame:CGRectZero];
        [toggle addTarget:self action:@selector(zfb_switchChanged:) forControlEvents:UIControlEventValueChanged];
        [cell setAccessoryView:toggle];
    }
    [toggle setTag:row];
    [toggle setOn:[ZFBSettings zfb_boolForKey:key] animated:NO];
    return cell;
}

- (void)zfb_switchChanged:(UISwitch *)sender {
    NSInteger row = [sender tag];
    if (row < 0 || row >= zfb_rowCount) return;
    NSString *key = [NSString stringWithUTF8String:zfb_rows[row].key];
    [ZFBSettings zfb_setBool:[sender isOn] forKey:key];
    [ZFBSettings applySettingsChange];
}

@end

#pragma mark - 面板根控制器（遮罩 + 卡片）

@interface ZFBPanelRootViewController : UIViewController

@property (nonatomic, strong) UIView *dimView;
@property (nonatomic, strong) UIView *cardView;
@property (nonatomic, strong) UILabel *titleLabel;
@property (nonatomic, strong) UIButton *doneButton;
@property (nonatomic, strong) ZFBSettingsTableViewController *tableVC;

@end

@implementation ZFBPanelRootViewController

- (void)viewDidLoad {
    [super viewDidLoad];
    [[self view] setBackgroundColor:[UIColor clearColor]];

    _dimView = [[UIView alloc] initWithFrame:CGRectZero];
    [_dimView setBackgroundColor:[UIColor colorWithWhite:0.0 alpha:0.35]];
    UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc] initWithTarget:[ZFBSettings class] action:@selector(hidePanel)];
    [_dimView addGestureRecognizer:tap];
    [[self view] addSubview:_dimView];

    _cardView = [[UIView alloc] initWithFrame:CGRectZero];
    [_cardView setBackgroundColor:[UIColor systemBackgroundColor]];
    [[_cardView layer] setCornerRadius:18.0];
    [_cardView setClipsToBounds:YES];
    [[self view] addSubview:_cardView];

    _titleLabel = [[UILabel alloc] initWithFrame:CGRectZero];
    [_titleLabel setText:@"支付宝精简"];
    [_titleLabel setFont:[UIFont boldSystemFontOfSize:17.0]];
    [_titleLabel setTextAlignment:NSTextAlignmentCenter];
    [_cardView addSubview:_titleLabel];

    _tableVC = [[ZFBSettingsTableViewController alloc] initWithStyle:UITableViewStyleGrouped];
    [self addChildViewController:_tableVC];
    [_cardView addSubview:[_tableVC view]];
    [_tableVC didMoveToParentViewController:self];

    _doneButton = [UIButton buttonWithType:UIButtonTypeSystem];
    [_doneButton setTitle:@"完成" forState:UIControlStateNormal];
    [[_doneButton titleLabel] setFont:[UIFont systemFontOfSize:17.0]];
    [_doneButton addTarget:[ZFBSettings class] action:@selector(hidePanel) forControlEvents:UIControlEventTouchUpInside];
    [_cardView addSubview:_doneButton];
}

- (void)viewDidLayoutSubviews {
    [super viewDidLayoutSubviews];
    CGRect bounds = [[self view] bounds];
    [self.dimView setFrame:bounds];

    CGFloat cardWidth = MIN(bounds.size.width - 48.0, 360.0);
    CGFloat cardHeight = MIN(bounds.size.height - 160.0, 520.0);
    CGFloat cardX = (bounds.size.width - cardWidth) * 0.5;
    CGFloat cardY = (bounds.size.height - cardHeight) * 0.5;
    [self.cardView setFrame:CGRectMake(cardX, cardY, cardWidth, cardHeight)];

    [self.titleLabel setFrame:CGRectMake(0, 0, cardWidth, 52.0)];
    [self.doneButton setFrame:CGRectMake(0, cardHeight - 48.0, cardWidth, 48.0)];
    [[self.tableVC view] setFrame:CGRectMake(0, 52.0, cardWidth, cardHeight - 52.0 - 48.0)];
}

@end

#pragma mark - ZFBSettings

@implementation ZFBSettings

+ (NSString *)zfb_plistPath {
    NSArray *dirs = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES);
    NSString *docs = ([dirs count] > 0) ? (NSString *)[dirs objectAtIndex:0] : NSTemporaryDirectory();
    return [docs stringByAppendingPathComponent:kZFBPlistName];
}

+ (NSMutableDictionary *)zfb_store {
    if (zfb_store == nil) {
        NSDictionary *loaded = [NSDictionary dictionaryWithContentsOfFile:[self zfb_plistPath]];
        if (loaded != nil) {
            zfb_store = [loaded mutableCopy];
        } else {
            zfb_store = [NSMutableDictionary dictionary];
        }
    }
    return zfb_store;
}

+ (void)zfb_persist {
    [[self zfb_store] writeToFile:[self zfb_plistPath] atomically:YES];
}

+ (BOOL)zfb_boolForKey:(NSString *)key {
    NSNumber *value = (NSNumber *)[[self zfb_store] objectForKey:key];
    if (value == nil) return YES; // 无记录 = 默认开。
    return [value boolValue];
}

+ (void)zfb_setBool:(BOOL)enabled forKey:(NSString *)key {
    [[self zfb_store] setObject:[NSNumber numberWithBool:enabled] forKey:key];
    [self zfb_persist];
}

+ (BOOL)floatBarEnabled { return [self zfb_boolForKey:kKeyFloatBar]; }
+ (BOOL)searchBarEnabled { return [self zfb_boolForKey:kKeySearchBar]; }
+ (BOOL)feedBlockEnabled { return [self zfb_boolForKey:kKeyFeedBlock]; }
+ (BOOL)cardPurifyEnabled { return [self zfb_boolForKey:kKeyCardPurify]; }
+ (BOOL)navPurifyEnabled { return [self zfb_boolForKey:kKeyNavPurify]; }
+ (BOOL)restoreTabEnabled { return [self zfb_boolForKey:kKeyRestoreTab]; }

+ (void)setFloatBarEnabled:(BOOL)enabled { [self zfb_setBool:enabled forKey:kKeyFloatBar]; }
+ (void)setSearchBarEnabled:(BOOL)enabled { [self zfb_setBool:enabled forKey:kKeySearchBar]; }
+ (void)setFeedBlockEnabled:(BOOL)enabled { [self zfb_setBool:enabled forKey:kKeyFeedBlock]; }
+ (void)setCardPurifyEnabled:(BOOL)enabled { [self zfb_setBool:enabled forKey:kKeyCardPurify]; }
+ (void)setNavPurifyEnabled:(BOOL)enabled { [self zfb_setBool:enabled forKey:kKeyNavPurify]; }
+ (void)setRestoreTabEnabled:(BOOL)enabled { [self zfb_setBool:enabled forKey:kKeyRestoreTab]; }

+ (NSString *)zfb_restoreIndexKey {
    NSString *bid = [[NSBundle mainBundle] bundleIdentifier];
    if (bid == nil) bid = @"zfbpay";
    return [NSString stringWithFormat:@"%@.frostbar.lastOfficialTab.v2", bid];
}

+ (NSString *)zfb_restoreSignatureKey {
    NSString *bid = [[NSBundle mainBundle] bundleIdentifier];
    if (bid == nil) bid = @"zfbpay";
    return [NSString stringWithFormat:@"%@.frostbar.lastTabOrderSignature.v1", bid];
}

+ (NSNumber *)lastTabIndex {
    id value = [[self zfb_store] objectForKey:[self zfb_restoreIndexKey]];
    if ([value isKindOfClass:[NSNumber class]]) return (NSNumber *)value;
    return nil;
}

+ (NSString *)lastTabSignature {
    id value = [[self zfb_store] objectForKey:[self zfb_restoreSignatureKey]];
    if ([value isKindOfClass:[NSString class]]) return (NSString *)value;
    return nil;
}

+ (void)saveLastTabIndex:(NSInteger)index signature:(NSString *)signature {
    [[self zfb_store] setObject:[NSNumber numberWithInteger:index] forKey:[self zfb_restoreIndexKey]];
    if (signature != nil) {
        [[self zfb_store] setObject:signature forKey:[self zfb_restoreSignatureKey]];
    }
    [self zfb_persist];
}

+ (void)noteTabBar:(UITabBar *)tabBar container:(UIView *)container {
    zfb_knownTabBar = tabBar;
    zfb_knownContainer = container;
}

+ (void)applySettingsChange {
    UITabBar *tabBar = zfb_knownTabBar;
    UIView *container = zfb_knownContainer;
    if (tabBar != nil) {
        [tabBar setNeedsLayout];
        [tabBar layoutIfNeeded];
    }
    if (container != nil) {
        [container setNeedsLayout];
    }
}

#pragma mark - 长按手势与面板

+ (void)ensureLongPressGestureInContainer:(UIView *)container {
    if (container == nil) return;
    if (objc_getAssociatedObject(container, &kZFBLongPressKey) != nil) return;
    UILongPressGestureRecognizer *gr = [[UILongPressGestureRecognizer alloc] initWithTarget:self action:@selector(zfb_handleLongPress:)];
    [gr setMinimumPressDuration:0.5];
    [gr setCancelsTouchesInView:NO];
    [container addGestureRecognizer:gr];
    objc_setAssociatedObject(container, &kZFBLongPressKey, gr, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

+ (void)zfb_handleLongPress:(UILongPressGestureRecognizer *)gr {
    if ([gr state] != UIGestureRecognizerStateBegan) return;
    UIView *container = [gr view];
    if (container == nil) return;
    CGPoint point = [gr locationInView:container];
    CGRect zone = CGRectZero;
    ZFBFloatBar *bar = [ZFBFloatBar sharedBar];
    if (bar != nil && ![bar isHidden] && [bar alpha] > 0.01 && [bar superview] == container) {
        zone = CGRectInset([bar frame], -8.0, -8.0);
    } else {
        CGRect bounds = [container bounds];
        UIEdgeInsets safe = [container safeAreaInsets];
        CGFloat zoneHeight = 120.0 + safe.bottom;
        zone = CGRectMake(0, bounds.size.height - zoneHeight, bounds.size.width, zoneHeight);
    }
    if (!CGRectContainsPoint(zone, point)) return;
    ZFBHaptic();
    [self showPanel];
}

+ (void)showPanel {
    if (zfb_panelShowing) return;
    zfb_previousKeyWindow = ZFBKeyWindow();
    if (zfb_panelWindow == nil) {
        // iOS 13+ 必须把窗口挂到前台 scene 上，否则可能不显示。
        UIWindowScene *scene = nil;
        for (UIScene *s in [[UIApplication sharedApplication] connectedScenes]) {
            if ([s activationState] == UISceneActivationStateForegroundActive &&
                [s isKindOfClass:[UIWindowScene class]]) {
                scene = (UIWindowScene *)s;
                break;
            }
        }
        if (scene != nil) {
            zfb_panelWindow = [[UIWindow alloc] initWithWindowScene:scene];
            [zfb_panelWindow setFrame:[[UIScreen mainScreen] bounds]];
        } else {
            zfb_panelWindow = [[UIWindow alloc] initWithFrame:[[UIScreen mainScreen] bounds]];
        }
        [zfb_panelWindow setWindowLevel:UIWindowLevelAlert + 1];
        [zfb_panelWindow setBackgroundColor:[UIColor clearColor]];
        ZFBPanelRootViewController *rootVC = [[ZFBPanelRootViewController alloc] init];
        [zfb_panelWindow setRootViewController:rootVC];
    }
    ZFBPanelRootViewController *rootVC = (ZFBPanelRootViewController *)[zfb_panelWindow rootViewController];
    [[[rootVC tableVC] tableView] reloadData];
    [zfb_panelWindow setHidden:NO];
    [zfb_panelWindow makeKeyWindow];
    zfb_panelShowing = YES;
}

+ (void)hidePanel {
    if (!zfb_panelShowing) return;
    [zfb_panelWindow setHidden:YES];
    [zfb_panelWindow resignKeyWindow];
    if (zfb_previousKeyWindow != nil) {
        [zfb_previousKeyWindow makeKeyWindow];
        zfb_previousKeyWindow = nil;
    }
    zfb_panelShowing = NO;
}

@end
