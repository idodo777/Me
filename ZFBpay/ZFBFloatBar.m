//
//  ZFBFloatBar.m
//  ZFBpay v1 —— 磨砂悬浮底栏实现
//
//  重建实现（待真机验证）。外观尺寸照手册 §3：
//    搜索圆钮 48×48 r24；功能胶囊高 52 r26；搜索与胶囊间距 10；
//    功能槽位宽 56（空间不足时下探至 40）；胶囊左右内边距 10；
//    整组距可用边界至少 12；一层 blur + 一层白衬底 alpha 0.78；
//    图标独立 UIImageView 放磨砂上方；槽位：27×27 圆形图标底 +
//    17×17 白色图标 + 10pt 文字；选中黄色 RGB(1,0.79,0)+黑字，
//    未选中灰底+深灰字；bottomOffset = 7（手册情况 B）。
//  偏离手册的一处：blur 用 SystemMaterial（自适应深浅色），
//  手册写 SystemMaterialLight；用户手机 iOS 27 深色模式下
//  SystemMaterial 更合适。待真机确认观感。
//
//  挂载点：tabBar.superview（与 AlipayLite 已验证的搜索条同款，
//  近手册情况 B）。A/B 抉择无 TraceX 证据，列为 TODO（见 README）。
//

#import "ZFBFloatBar.h"
#import "ZFBHelpers.h"

static const CGFloat kZFBBarHeight = 52.0;
static const CGFloat kZFBSearchSize = 48.0;
static const CGFloat kZFBSearchGap = 10.0;
static const CGFloat kZFBSlotWidthMax = 56.0;
static const CGFloat kZFBSlotWidthMin = 40.0;
static const CGFloat kZFBCapsulePadding = 10.0;
static const CGFloat kZFBEdgeMargin = 12.0;
static const CGFloat kZFBBarBottomOffset = 7.0;
static const CGFloat kZFBWhiteOverlayAlpha = 0.78;

static const NSInteger kZFBTagCircle = 101;
static const NSInteger kZFBTagIcon = 102;
static const NSInteger kZFBTagTitle = 103;
static const NSInteger kZFBTagBadge = 104;
static const NSInteger kZFBTagFallback = 105;

@interface ZFBFloatBar ()

@property (nonatomic, strong) UIView *capsuleView;
@property (nonatomic, strong) UIView *searchContainer;
@property (nonatomic, strong) UIButton *searchButton;
@property (nonatomic, strong) NSMutableArray<UIButton *> *tabButtons;
@property (nonatomic, strong) NSString *itemsSignature;
@property (nonatomic, assign) NSInteger selectedIndex;
@property (nonatomic, weak) UITabBar *tabBar;

- (void)zfb_rebuildIfNeededWithItems:(NSArray *)items;
- (void)zfb_refreshButtonStatesWithItems:(NSArray *)items;
- (void)zfb_tabButtonTapped:(UIButton *)sender;
- (void)zfb_searchButtonTapped:(UIButton *)sender;

@end

@implementation ZFBFloatBar

+ (instancetype)sharedBar {
    static ZFBFloatBar *shared = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        shared = [[ZFBFloatBar alloc] initWithFrame:CGRectZero];
    });
    return shared;
}

- (instancetype)initWithFrame:(CGRect)frame {
    self = [super initWithFrame:frame];
    if (self == nil) return nil;
    _tabButtons = [NSMutableArray array];
    _selectedIndex = -1;
    [self setBackgroundColor:[UIColor clearColor]];
    [self setUserInteractionEnabled:YES];

    // 功能胶囊：blur + 白衬底 + clipsToBounds。
    _capsuleView = [[UIView alloc] initWithFrame:CGRectZero];
    [_capsuleView setBackgroundColor:[UIColor clearColor]];
    [[_capsuleView layer] setCornerRadius:26.0];
    [_capsuleView setClipsToBounds:YES];
    UIVisualEffectView *capsuleBlur = [[UIVisualEffectView alloc] initWithEffect:[UIBlurEffect effectWithStyle:UIBlurEffectStyleSystemMaterial]];
    [capsuleBlur setFrame:[_capsuleView bounds]];
    [capsuleBlur setAutoresizingMask:(UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight)];
    [_capsuleView addSubview:capsuleBlur];
    UIView *capsuleWhite = [[UIView alloc] initWithFrame:[_capsuleView bounds]];
    [capsuleWhite setBackgroundColor:[UIColor colorWithWhite:1.0 alpha:kZFBWhiteOverlayAlpha]];
    [capsuleWhite setAutoresizingMask:(UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight)];
    [_capsuleView addSubview:capsuleWhite];
    [self addSubview:_capsuleView];

    // 搜索圆钮：独立容器（blur + 白衬底）+ 透明按钮在上。
    _searchContainer = [[UIView alloc] initWithFrame:CGRectZero];
    [_searchContainer setBackgroundColor:[UIColor clearColor]];
    [[_searchContainer layer] setCornerRadius:24.0];
    [_searchContainer setClipsToBounds:YES];
    UIVisualEffectView *searchBlur = [[UIVisualEffectView alloc] initWithEffect:[UIBlurEffect effectWithStyle:UIBlurEffectStyleSystemMaterial]];
    [searchBlur setFrame:[_searchContainer bounds]];
    [searchBlur setAutoresizingMask:(UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight)];
    [_searchContainer addSubview:searchBlur];
    UIView *searchWhite = [[UIView alloc] initWithFrame:[_searchContainer bounds]];
    [searchWhite setBackgroundColor:[UIColor colorWithWhite:1.0 alpha:kZFBWhiteOverlayAlpha]];
    [searchWhite setAutoresizingMask:(UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight)];
    [_searchContainer addSubview:searchWhite];
    _searchButton = [UIButton buttonWithType:UIButtonTypeCustom];
    [_searchButton setFrame:[_searchContainer bounds]];
    [_searchButton setAutoresizingMask:(UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight)];
    [_searchButton setImage:[UIImage systemImageNamed:@"magnifyingglass"] forState:UIControlStateNormal];
    [_searchButton setTintColor:[UIColor grayColor]];
    [_searchButton addTarget:self action:@selector(zfb_searchButtonTapped:) forControlEvents:UIControlEventTouchUpInside];
    [_searchContainer addSubview:_searchButton];
    [self addSubview:_searchContainer];

    return self;
}

#pragma mark - 安装与布局

- (void)zfb_installInContainer:(UIView *)container tabBar:(UITabBar *)tabBar {
    if (container == nil || tabBar == nil) return;
    self.tabBar = tabBar;
    NSArray *items = [tabBar items];
    [self zfb_rebuildIfNeededWithItems:items];

    CGRect bounds = [container bounds];
    UIEdgeInsets safe = [container safeAreaInsets];
    CGFloat available = bounds.size.width - safe.left - safe.right - (kZFBEdgeMargin * 2.0);
    NSInteger count = (NSInteger)[items count];
    if (count <= 0) count = 1;
    CGFloat slotWidth = kZFBSlotWidthMax;
    CGFloat groupWidth = (kZFBCapsulePadding * 2.0) + slotWidth * count + kZFBSearchGap + kZFBSearchSize;
    while (groupWidth > available && slotWidth > kZFBSlotWidthMin) {
        slotWidth -= 2.0;
        groupWidth = (kZFBCapsulePadding * 2.0) + slotWidth * count + kZFBSearchGap + kZFBSearchSize;
    }
    CGFloat width = MIN(groupWidth, available);
    CGFloat x = (bounds.size.width - width) * 0.5;
    if (x < safe.left + kZFBEdgeMargin) x = safe.left + kZFBEdgeMargin;
    CGFloat y = bounds.size.height - safe.bottom - kZFBBarHeight - kZFBBarBottomOffset;
    [self setFrame:CGRectMake(x, y, width, kZFBBarHeight)];
    [self setHidden:NO];
    [self setAlpha:1.0];
    [self setUserInteractionEnabled:YES];
    if ([self superview] != container) {
        [container addSubview:self];
    }
    [container bringSubviewToFront:self];
    [self setNeedsLayout];
}

- (void)layoutSubviews {
    [super layoutSubviews];
    CGRect bounds = [self bounds];
    CGFloat barWidth = bounds.size.width;
    CGFloat barHeight = bounds.size.height;

    // 胶囊在左，搜索圆钮在右，间距 10。
    CGFloat searchY = (barHeight - kZFBSearchSize) * 0.5;
    [self.searchContainer setFrame:CGRectMake(barWidth - kZFBSearchSize, searchY, kZFBSearchSize, kZFBSearchSize)];
    CGFloat capsuleWidth = barWidth - kZFBSearchSize - kZFBSearchGap;
    if (capsuleWidth < 0) capsuleWidth = 0;
    [self.capsuleView setFrame:CGRectMake(0, 0, capsuleWidth, barHeight)];

    NSInteger count = (NSInteger)[self.tabButtons count];
    if (count <= 0) return;
    CGFloat slotWidth = (capsuleWidth - (kZFBCapsulePadding * 2.0)) / (CGFloat)count;
    for (NSInteger i = 0; i < count; i++) {
        UIButton *button = (UIButton *)[self.tabButtons objectAtIndex:i];
        [button setFrame:CGRectMake(kZFBCapsulePadding + slotWidth * (CGFloat)i, 0, slotWidth, barHeight)];

        UIView *circle = [button viewWithTag:kZFBTagCircle];
        CGFloat circleX = (slotWidth - 27.0) * 0.5;
        [circle setFrame:CGRectMake(circleX, 5.0, 27.0, 27.0)];

        UIImageView *icon = (UIImageView *)[button viewWithTag:kZFBTagIcon];
        [icon setFrame:CGRectMake(circleX + 5.0, 10.0, 17.0, 17.0)];

        UILabel *fallback = (UILabel *)[button viewWithTag:kZFBTagFallback];
        if (fallback != nil) {
            [fallback setFrame:CGRectMake(circleX, 5.0, 27.0, 27.0)];
        }

        UILabel *title = (UILabel *)[button viewWithTag:kZFBTagTitle];
        [title setFrame:CGRectMake(0, 36.0, slotWidth, 12.0)];

        UILabel *badge = (UILabel *)[button viewWithTag:kZFBTagBadge];
        if (![badge isHidden]) {
            CGSize textSize = [badge sizeThatFits:CGSizeMake(60.0, 16.0)];
            CGFloat badgeWidth = MAX(16.0, textSize.width + 8.0);
            [badge setFrame:CGRectMake(circleX + 27.0 - badgeWidth + 6.0, 1.0, badgeWidth, 16.0)];
        }
    }
}

- (void)traitCollectionDidChange:(UITraitCollection *)previousTraitCollection {
    [super traitCollectionDidChange:previousTraitCollection];
    [self setNeedsLayout];
}

#pragma mark - 按钮重建与状态

- (void)zfb_rebuildIfNeededWithItems:(NSArray *)items {
    NSMutableArray *parts = [NSMutableArray array];
    for (UITabBarItem *item in items) {
        NSString *title = [item title];
        if (title == nil) title = @"";
        NSString *badge = [item badgeValue];
        if (badge == nil) badge = @"";
        NSString *hasImage = ([item image] != nil) ? @"1" : @"0";
        [parts addObject:[NSString stringWithFormat:@"%@|%@|%@", title, badge, hasImage]];
    }
    NSString *signature = [parts componentsJoinedByString:@";"];
    if ([signature isEqualToString:self.itemsSignature]) return;
    self.itemsSignature = signature;

    for (UIButton *button in self.tabButtons) {
        [button removeFromSuperview];
    }
    [self.tabButtons removeAllObjects];

    for (NSInteger i = 0; i < (NSInteger)[items count]; i++) {
        UITabBarItem *item = (UITabBarItem *)[items objectAtIndex:i];
        UIButton *button = [UIButton buttonWithType:UIButtonTypeCustom];
        [button setTag:i];
        [button addTarget:self action:@selector(zfb_tabButtonTapped:) forControlEvents:UIControlEventTouchUpInside];

        UIView *circle = [[UIView alloc] initWithFrame:CGRectZero];
        [circle setTag:kZFBTagCircle];
        [[circle layer] setCornerRadius:13.5];
        [button addSubview:circle];

        UIImageView *icon = [[UIImageView alloc] initWithFrame:CGRectZero];
        [icon setTag:kZFBTagIcon];
        [icon setContentMode:UIViewContentModeScaleAspectFit];
        [icon setTintColor:[UIColor whiteColor]];
        UIImage *image = [item image];
        if (image != nil) {
            [icon setImage:[image imageWithRenderingMode:UIImageRenderingModeAlwaysTemplate]];
        }
        [button addSubview:icon];

        UILabel *titleLabel = [[UILabel alloc] initWithFrame:CGRectZero];
        [titleLabel setTag:kZFBTagTitle];
        [titleLabel setFont:[UIFont systemFontOfSize:10.0]];
        [titleLabel setTextAlignment:NSTextAlignmentCenter];
        NSString *title = [item title];
        if (title == nil) title = @"";
        [titleLabel setText:title];
        [button addSubview:titleLabel];

        UILabel *badge = [[UILabel alloc] initWithFrame:CGRectZero];
        [badge setTag:kZFBTagBadge];
        [badge setFont:[UIFont boldSystemFontOfSize:9.0]];
        [badge setTextAlignment:NSTextAlignmentCenter];
        [badge setTextColor:[UIColor whiteColor]];
        [badge setBackgroundColor:[UIColor redColor]];
        [[badge layer] setCornerRadius:8.0];
        [badge setClipsToBounds:YES];
        [badge setHidden:YES];
        [button addSubview:badge];

        // 无图标时用标题首字顶位（纯自有 UI 兜底，不涉私有 API）。
        if (image == nil && [title length] > 0) {
            [icon setHidden:YES];
            UILabel *fallback = [[UILabel alloc] initWithFrame:CGRectZero];
            [fallback setTag:kZFBTagFallback];
            [fallback setFont:[UIFont boldSystemFontOfSize:12.0]];
            [fallback setTextAlignment:NSTextAlignmentCenter];
            [fallback setTextColor:[UIColor whiteColor]];
            [fallback setText:[title substringToIndex:1]];
            [button addSubview:fallback];
        }

        [self.capsuleView addSubview:button];
        [self.tabButtons addObject:button];
    }
    [self zfb_refreshButtonStatesWithItems:items];
    [self setNeedsLayout];
}

- (void)zfb_refreshButtonStatesWithItems:(NSArray *)items {
    UIColor *selectedCircle = [UIColor colorWithRed:1.0 green:0.79 blue:0.0 alpha:1.0];
    UIColor *unselectedCircle = [UIColor systemGray4Color];
    for (NSInteger i = 0; i < (NSInteger)[self.tabButtons count]; i++) {
        UIButton *button = (UIButton *)[self.tabButtons objectAtIndex:i];
        BOOL selected = (i == self.selectedIndex);
        UIView *circle = [button viewWithTag:kZFBTagCircle];
        [circle setBackgroundColor:(selected ? selectedCircle : unselectedCircle)];
        UILabel *title = (UILabel *)[button viewWithTag:kZFBTagTitle];
        [title setTextColor:(selected ? [UIColor blackColor] : [UIColor darkGrayColor])];
        // 角标：简单显示 badgeValue（手册 §7 的红点语义待真机验证）。
        UILabel *badge = (UILabel *)[button viewWithTag:kZFBTagBadge];
        NSString *badgeValue = nil;
        if (i < (NSInteger)[items count]) {
            badgeValue = [(UITabBarItem *)[items objectAtIndex:i] badgeValue];
        }
        if (badgeValue != nil && [badgeValue length] > 0) {
            [badge setText:badgeValue];
            [badge setHidden:NO];
        } else {
            [badge setHidden:YES];
        }
    }
}

- (void)zfb_updateSelectionFromTabBar:(UITabBar *)tabBar {
    if (tabBar == nil) return;
    NSArray *items = [tabBar items];
    UITabBarItem *selected = [tabBar selectedItem];
    NSInteger index = -1;
    for (NSInteger i = 0; i < (NSInteger)[items count]; i++) {
        if ([items objectAtIndex:i] == selected) {
            index = i;
            break;
        }
    }
    self.selectedIndex = index;
    [self zfb_refreshButtonStatesWithItems:items];
}

- (void)zfb_setBarHidden:(BOOL)hidden {
    [self setHidden:hidden];
    [self setAlpha:(hidden ? 0.0 : 1.0)];
}

#pragma mark - 点击

- (void)zfb_tabButtonTapped:(UIButton *)sender {
    NSInteger index = [sender tag];
    ZFBHaptic();
    ZFBNoteUserChoseTab();
    UIWindow *keyWindow = ZFBKeyWindow();
    UITabBarController *tbc = ZFBFindTabBarController([keyWindow rootViewController]);
    if (tbc != nil && index >= 0 && index < (NSInteger)[[tbc viewControllers] count]) {
        [tbc setSelectedIndex:index];
        ZFBNoteTabBarSelection(index, tbc);
    }
    if (self.tabBar != nil) {
        [self zfb_updateSelectionFromTabBar:self.tabBar];
    }
}

- (void)zfb_searchButtonTapped:(UIButton *)sender {
    (void)sender;
    (void)ZFBTriggerSearch();
    ZFBHaptic();
}

@end
