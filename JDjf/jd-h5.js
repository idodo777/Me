// 京东 H5 商品页转链（Egern 版）1.3 新加
// 拦截：item.m.jd.com 商品页 + ccc-x.jd.com/dsp/nc 点击追踪（ext 里 base64 的商品链接）
// 2026-11-28 抓包实锤：京东 16.1.90 的商品详情不再走原生 wareBusiness，
//   京粉 H5 页里点商品只发 ccc-x/dsp/nc 追踪（ext=base64 的 item.m.jd.com 商品链接），
//   商品页本身不走 item.m.jd.com 直连；所以只拦原生接口的 1.1/1.2 永远触发不了，
//   必须从点击追踪里把商品链接抠出来再转。
// 用法：京粉 H5 页 / H5 商品页点开商品，弹一条返利通知，点通知一键跳转到返利后的商品页。
// 转链逻辑与 jdjf.js 的 convert() 同款（ConvertSuperLink），Cookie 只用 JD_COOKIE 参数或已捕获京粉 CK。
// 注意：ccc-x 是广告追踪接口，只认 ext 解出来是 item.m.jd.com 商品链接的才转；
//   同一商品 30 秒内只转一次，防重复弹。

export default async function (ctx) {
  if ((ctx.env.JF_CONVERT ?? "true") === "false") return;
  const url = String((ctx.request && ctx.request.url) || "");
  let productUrl = "";

  // ① H5 商品页直链（从微信/外链/搜索结果点进来的 H5 商品页）
  if (/^https?:\/\/item\.m\.jd\.com\/product\/\d+\.html/.test(url)) {
    productUrl = url;
  }
  // ② 京粉 H5 页点商品：只发 ccc-x/dsp/nc 追踪，ext 是 base64 的商品链接
  else if (/^https?:\/\/ccc-x\.jd\.com\/dsp\/nc/.test(url)) {
    try {
      const m = url.match(/[?&]ext=([^&]+)/);
      if (!m) return;
      let raw = m[1];
      try {
        raw = decodeURIComponent(raw);
      } catch (e) {}
      const dec = b64decode(raw);
      const pm = dec.match(/https?:\/\/item\.m\.jd\.com\/product\/(\d+)\.html/);
      if (!pm) return;
      productUrl = pm[0];
    } catch (e) {
      return;
    }
  } else {
    return;
  }

  // 同一商品 30 秒内只转一次（追踪可能连发两次）
  const skuM = productUrl.match(/\/product\/(\d+)\.html/);
  const sku = skuM ? skuM[1] : productUrl;
  try {
    const last = ctx.storage.get("jd_h5_last") || "";
    const parts = last.split("|");
    if (parts[0] === sku && Date.now() - Number(parts[1] || 0) < 30000) return;
    ctx.storage.set("jd_h5_last", sku + "|" + String(Date.now()));
  } catch (e) {}

  const convCookie = getConvertCookie(ctx);

  // 转链 4 秒硬超时：挂住也不拖死通知
  const conv = await withTimeout(convert(ctx, productUrl, convCookie, "openjd", false), 4000, "TIMEOUT");

  let openUrl = "";
  let msg = "";
  if (conv === "TIMEOUT") {
    msg = "转链超时（4 秒没返回）";
  } else if (conv && typeof conv === "object") {
    if (conv.msg) msg = conv.msg;
    if (conv.convertURL) openUrl = conv.convertURL;
  } else if (typeof conv === "string" && conv) {
    msg = conv;
  }
  // 任何情况都弹一条，写清原因，杜绝“打开商品什么都没有”
  if (!msg) msg = "该商品暂无返利信息";

  if (openUrl) {
    ctx.notify({ title: "京东京粉转链", body: msg, action: { type: "openUrl", url: openUrl } });
  } else {
    ctx.notify({ title: "京东京粉转链", body: msg });
  }
  // http_request 脚本不返回内容，原请求原样放行
}

// base64 解码（纯 JS，不依赖 atob；容忍缺 padding 与 URL-safe 字符；解出来是 ASCII 链接）
function b64decode(input) {
  let s = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i + 3 < s.length + 1 && i < s.length; i += 4) {
    const a = chars.indexOf(s[i]);
    const b = chars.indexOf(s[i + 1]);
    const c = chars.indexOf(s[i + 2]);
    const d = chars.indexOf(s[i + 3]);
    if (a < 0 || b < 0) break;
    const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    out += String.fromCharCode((n >> 16) & 255);
    if (c >= 0) out += String.fromCharCode((n >> 8) & 255);
    if (d >= 0) out += String.fromCharCode(n & 255);
  }
  return out;
}

// 任意 promise 超时即返回 fallback，不抛错
function withTimeout(p, ms, fallback) {
  return Promise.race([
    p,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// ---------- 转链 Cookie 优先级（与 jdjf.js 同款：只用存好的完整 Cookie，从不用请求里带的 Cookie；
//   京东 App 请求里只有 wskey，ConvertSuperLink 不认 wskey，拿去撞只会 403） ----------
//   优先级：模块参数 JD_COOKIE（填青龙 JD_COOKIE 的完整值）→ 已捕获的京粉 CK；
//   都没有就返回 ""，convert() 会明说“请填 JD_COOKIE”，不再拿 wskey 去试。

function getConvertCookie(ctx) {
  try {
    if (ctx.env.JD_COOKIE && String(ctx.env.JD_COOKIE).trim()) {
      return String(ctx.env.JD_COOKIE).trim();
    }
  } catch (e) {}
  try {
    const u = ctx.storage.get("jd_union_cookie") || "";
    if (u) return u;
  } catch (e) {}
  return "";
}

// ---------- 京粉转链（与 jdjf.js 的 convert() 同款，上游 Tartarus 写法） ----------

async function convert(ctx, url, cookie, autoScheme, isOriginJXURL) {
  if (!cookie) return "转链无完整 Cookie：请把青龙 JD_COOKIE 的值填进模块参数 JD_COOKIE";
  let id;
  if (url.includes("item.m.jd") || url.includes("item.jd")) {
    const m = url.match(/(\d+)\.html/);
    if (!m) return "";
    id = m[1];
    url = `https://item.m.jd.com/product/${id}.html`;
  } else if (url.includes("m.jingxi") || url.includes("wq.jd.com")) {
    const m = url.match(/sku=(\d+)/);
    if (!m) return "";
    id = m[1];
    url = `https://wq.jd.com/item/view?sku=${id}`;
    if (isOriginJXURL) url = `https://m.jingxi.com/item/jxview?sku=${id}`;
    autoScheme = "openapp.jdpingou";
  } else if (url.includes("kpl.m.jd")) {
    const m = url.match(/wareId=(\d+)/);
    if (!m) return "";
    id = m[1];
    url = `https://kpl.m.jd.com/product?wareId=${id}`;
    autoScheme = "browser";
  }

  const body = {
    funName: "getSuperClickUrl",
    param: {
      materialInfo: url,
      ext1: "200|100_3|",
    },
  };
  // 联盟 ID：ntchat 的可用实现在 body 顶层传 unionId；没填就不传
  try {
    const uid = String((ctx.env && ctx.env.JD_UNION_ID) || "").trim();
    if (uid) body.unionId = /^\d+$/.test(uid) ? Number(uid) : uid;
  } catch (e) {}
  const t = Date.now();
  // 上游同款 encodeURI（不用 encodeURIComponent），其余参数与上游逐字一致
  const apiUrl =
    `https://api.m.jd.com/api?functionId=ConvertSuperLink&appid=u&_=${t}&body=` +
    encodeURI(JSON.stringify(body)) +
    `&loginType=2`;

  let resp;
  try {
    resp = await ctx.http.get(apiUrl, {
      headers: {
        Cookie: cookie,
        Referer: "https://servicewechat.com/wxf463e50cd384beda/114/page-frame.html",
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 13_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.4(0x18000429) NetType/WIFI Language/zh_CN",
        "content-type": "application/json",
      },
    });
  } catch (e) {
    return "转链请求失败（网络不通或被拦截）";
  }

  let data;
  try {
    data = JSON.parse(await resp.text());
  } catch (e) {
    return "转链返回异常（接口被墙/403）";
  }

  const d = data.data || {};
  if (data.code === 200) {
    const r = {};
    const scheme = autoScheme;
    if (d.promotionUrl) {
      r.msg = `💴 预计返利 ➩ ${d.wlCommission} ║🏷 返利率 ➩ ${d.wlCommissionShare}%`;
      r.convertURL =
        scheme === "browser"
          ? d.promotionUrl
          : `${scheme}://virtual?params=%7B%22category%22:%22jump%22,%22des%22:%22m%22,%22sourceValue%22:%22babel-act%22,%22sourceType%22:%22babel%22,%22url%22:%22${d.promotionUrl}%22%7D`;
    } else {
      r.msg = `😤 该商品暂无详细返利，${(d.formatContext || "").trim()}`;
      r.convertURL =
        scheme === "browser"
          ? d.originalContext
          : `${scheme}://virtual?params=%7B%22category%22:%22jump%22,%22des%22:%22m%22,%22sourceValue%22:%22babel-act%22,%22sourceType%22:%22babel%22,%22url%22:%22${d.originalContext}%22%7D`;
    }
    return r;
  } else if (data.code === 105) {
    if (autoScheme === "openapp.jdpingou") return "useJXOrigin";
    return "";
  } else if (data.code === 430) {
    return "账号未开通京粉，转链不可用";
  } else {
    return `转链失败（code ${data.code}）`;
  }
}
