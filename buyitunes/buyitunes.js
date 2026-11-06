/*
 * BuyiTunes 多合一（Egern 干净重写版）
 * 机制与产品映射表来自 @ddgksf2013 的 buyitunes.vip.js（上游：https://ddgksf2013.top/scripts/buyitunes.vip.js）
 * 说明：原脚本核心经 jsjiami 混淆，本版只按其明文可见的机制重写——拦截 verifyReceipt 响应，
 * 按 bundle id 查表注入伪造的购买记录；不含原脚本的混淆代码、环境检测与水印字段。
 * 映射表第三项为 1 的是买断型（注入记录不带到期时间），为 0 的是订阅型（到期时间 2099 年 + 自动续订信息）。
 * 注意（原作者提醒）：使用后 App Store 可能无法切换账户，关掉本模块或 MITM 后恢复；解锁非永久，订阅类会被重新验证。
 */

const PRODUCT_MAP = {
  "default": [
    "ddgksf2013",
    "https://t.me/ddgksf2021",
    0
  ],
  "com.sugarmo.ScrollClip": [
    "picsewV3.9.4",
    "com.sugarmo.ScrollClip.pro",
    1
  ],
  "com.zijayrate.analogcam": [
    "oldroll",
    "com.zijayrate.analogcam.vipforever10",
    0
  ],
  "com.loveyouchenapps.knockout": [
    "proknockout",
    "com.knockout.7daysplus",
    0
  ],
  "net.shinyfrog.bear-iOS": [
    "bear",
    "net.shinyfrog.bear_iOS.pro_yearly_subscription_bis",
    0
  ],
  "com.yengshine.proccd": [
    "proccd",
    "com.yengshine.proccd.year",
    0
  ],
  "com.lifubing.lbs.stepOfLife": [
    "ss",
    "com.lifubing.lbs.stepOfLife.plus.year",
    0
  ],
  "com.yumiteam.Kuki.ID": [
    "PicsLeap",
    "com.yumiteam.Kuki.ID.4",
    1
  ],
  "com.calc.iphone": [
    "Calculator",
    "calc_Unlock_1",
    0
  ],
  "me.imgbase.intolive": [
    "intolive",
    "me.imgbase.intolive.proSubYearly",
    0
  ],
  "MVH6DNU2ZP.input": [
    "logcg",
    "com.logcg.loginput",
    1
  ],
  "com.waterminder.waterminder": [
    "waterminder",
    "waterminder.premiumYearly",
    0
  ],
  "wtf.riedel.one-sec": [
    "onesec",
    "wtf.riedel.one_sec.pro.annual.individual",
    0
  ],
  "com.aaaalab.nepacket": [
    "http",
    "com.li.blur.pro.month",
    0
  ],
  "com.inturnex.Sticker-Maker": [
    "Sticker",
    "com.inturnex.Sticker_Maker.full_access",
    1
  ],
  "FuYuan.inkDiary": [
    "Secai",
    "FuYuan.inkDiary.YearB.Pro",
    0
  ],
  "me.imgbase.imgplay": [
    "imgplay",
    "me.imgbase.imgplay.subscriptionYearly",
    0
  ],
  "com.mediaeditor.video": [
    "PrettyUp",
    "yearautorenew",
    0
  ],
  "com.anycasesolutions.SexTracker": [
    "SexTracker",
    "com.anycasesolutions.SexTracker.3mon",
    0
  ],
  "com.jianili.pawff": [
    "pawff",
    "com.jianili.pawff.pro.monthly",
    0
  ],
  "icar.ren.smk": [
    "smk",
    "smoke19870727",
    0
  ],
  "com.meditation.heartratehrv": [
    "meditation",
    "lifetimeusa",
    1
  ],
  "livintis.com.wallpapermonster": [
    "wallpaper",
    "wallpaperworld.subscription.yearly.12.notrial",
    0
  ],
  "com.tianlang.gifmaker": [
    "gifmaker",
    "com.tianlang.gifmaker.forever",
    1
  ],
  "me.imgbase.videoday": [
    "videoday",
    "me.imgbase.videoday.profeaturesYearly",
    0
  ],
  "com.icandiapps.nightsky": [
    "nightsky",
    "com.icandiapps.ns4.annual",
    0
  ],
  "com.lixkit.diary": [
    "diary",
    "com.lixkit.diary.permanent_68",
    0
  ],
  "com.touchbits.subscriptions": [
    "dyt",
    "com.touchbits.subscriptions.iap.pro.yearly",
    0
  ],
  "dev.sanjin.WasteCat": [
    "cat",
    "dev.sanjin.WasteCat.PermanentVip",
    1
  ],
  "com.zerone.hidesktop": [
    "iscreen",
    "com.zerone.hidesktop.forever",
    0
  ],
  "co.bazaart.app": [
    "bazaart",
    "Bazaart_Premium_Monthly_v9",
    0
  ],
  "com.pollykann.app": [
    "pollykann",
    "vip.forever.pollykann",
    1
  ],
  "org.zrey.money": [
    "costmemo",
    "org.zrey.money.lifetime",
    1
  ],
  "com.sfun.snapedit": [
    "weikeMusic",
    "com.moiseum.dailyart.subscription.Patron",
    0
  ],
  "com.polygitapp.polygit": [
    "polygit",
    "com.polygitapp.polygit.pro.yearly",
    0
  ],
  "com.sm.widget": [
    "colorwidget",
    "com.sm.widget.Pro",
    0
  ],
  "linsen.camera.app": [
    "shiguangxiangji",
    "linsen.camera.App.yearly",
    0
  ],
  "com.moiseum.dailyart": [
    "dailyart",
    "com.moiseum.dailyart.subscription.monthly",
    0
  ],
  "com.verycoolapp.epubreader": [
    "epubreader",
    "Epub Reader_ProVersion",
    1
  ],
  "com.daymore.Across": [
    "daymore",
    "com.daymore.across.lifetime",
    1
  ],
  "com.jyys.jianmovie": [
    "jianmovie",
    "com.year.jianying",
    0
  ]
};

const TXN = "1000000000000001";

function buildInApp(productId) {
  return {
    "quantity": "1",
    "product_id": productId,
    "transaction_id": TXN,
    "original_transaction_id": TXN,
    "purchase_date": "2023-12-05 07:59:59 Etc/GMT",
    "purchase_date_ms": "1701763199000",
    "purchase_date_pst": "2023-12-04 23:59:59 America/Los_Angeles",
    "original_purchase_date": "2023-12-04 23:59:59 Etc/GMT",
    "original_purchase_date_ms": "1701734399000",
    "original_purchase_date_pst": "2023-12-04 23:59:59 America/Los_Angeles",
    "expires_date": "2099-12-19 07:59:59 Etc/GMT",
    "expires_date_ms": "4101350399000",
    "expires_date_pst": "2099-12-18 23:59:59 America/Los_Angeles",
    "is_trial_period": "false",
    "is_in_intro_offer_period": "false",
    "web_order_line_item_id": "100000000000001",
    "in_app_ownership_type": "PURCHASED"
  };
}

export default async function (ctx) {
  try {
    // 不要用 ctx.response.json()：实测在 Egern 中会抛 pattern SyntaxError。
    let data = null;
    try { const t = await ctx.response.text(); data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
    if (data == null) { try { const b = await ctx.response.arrayBuffer(); data = JSON.parse(new TextDecoder('utf-8').decode(b)); } catch (e) { data = null; } }
    if (!data || typeof data !== "object" || !data.receipt || typeof data.receipt !== "object") return {};
    const mapping = PRODUCT_MAP[data.receipt.bundle_id] || PRODUCT_MAP["default"];
    const productId = mapping[1];
    const inapp = buildInApp(productId);
    if (mapping[2] === 1) {
      // 买断型：去掉到期字段，不写订阅信息
      delete inapp.expires_date;
      delete inapp.expires_date_ms;
      delete inapp.expires_date_pst;
    } else {
      // 订阅型：补最近收据与待续订信息
      data.latest_receipt_info = [inapp];
      data.status = 0;
      data.pending_renewal_info = [{
        "product_id": productId,
        "original_transaction_id": TXN,
        "auto_renew_product_id": productId,
        "auto_renew_status": "1"
      }];
    }
    data.receipt.in_app = [inapp];
    return { body: JSON.stringify(data) };
  } catch (e) {
    return {};
  }
}
