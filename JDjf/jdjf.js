// 京东京粉转链（Egern 版）0.8
// 上游作者：Tartarus2014（脚本）/ sempliciy（Surge 模块）
// 上游更新：脚本 2021-11-03；模块 2022-06-08
// 拦截数量：1（api.m.jd.com）
// 脚本数量：1（本文件，取上游 jf_Convert.js 的转链部分；历史比价已按用户要求去掉）
// 上游来源：https://github.com/sempliciy/Quantumult-X/blob/master/Surge/JD_Pirce.sgmodule
// 脚本来源：https://github.com/Tartarus2014/Script/blob/master/jf_Convert.js
// 用法：打开京东商品详情，弹一条返利通知，点通知一键跳转到返利后的商品页。
// Cookie：默认用京东 App 本次请求的 Cookie；转链失败时在模块参数里填京粉账号的 JD_COOKIE。
// 注意：转链只对已开通京东联盟（京粉）的账号生效；未开通会提示“暂无返利信息”。
// 0.8 改动（2026-11-27 用户令）：历史价格相关全部去掉，只留返利转链；
//   转链 4 秒硬超时，超时/失败都弹通知写清原因，打开商品必有一条通知，杜绝静默。

export default async function (ctx) {
  try {
    const url = ctx.request.url;
    // 只处理商品详情接口；serverConfig/basicConfig 等配置接口直接放行
    const isWare = url.includes("wareBusiness") || url.includes("pingou_item");
    if (!isWare) return;

    const useConvert = (ctx.env.JF_CONVERT ?? "true") !== "false";
    if (!useConvert) return;

    let obj;
    try {
      obj = JSON.parse(await ctx.response.text());
    } catch (e) {
      return;
    }

    const floors = obj.floors || [];
    const commodity = floors[floors.length - 1];
    const others = obj.others || {};
    const domain = obj.domain || {};
    let shareUrl = "";
    try {
      if (url.includes("pingou_item")) {
        shareUrl = domain.h5Url || "";
      } else if (url.includes("wareBusiness.style")) {
        shareUrl = (others.property && others.property.shareUrl) || "";
      } else {
        shareUrl =
          (commodity && commodity.data && commodity.data.property && commodity.data.property.shareUrl) || "";
      }
    } catch (e) {
      shareUrl = "";
    }
    if (!shareUrl) {
      ctx.notify({ title: "京东京粉转链", body: "没取到商品链接，商品页结构可能变了" });
      return;
    }

    const isPingou = url.includes("pingou_item");
    const isHealth = url.includes("wareBusiness.style");
    const autoScheme = isHealth ? "openApp.jdHealth" : "openjd";
    const cookie = getCookie(ctx);

    // 转链 4 秒硬超时：挂住也不拖死通知
    let conv = await withTimeout(convert(ctx, shareUrl, cookie, autoScheme, false), 4000, "TIMEOUT");
    if (conv === "useJXOrigin" && isPingou) {
      conv = await withTimeout(convert(ctx, shareUrl, cookie, autoScheme, true), 4000, "TIMEOUT");
    }

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
    // 不返回任何内容，原响应原样放行
  } catch (e) {
    // 失败放行，不影响商品页
  }
}

// 任意 promise 超时即返回 fallback，不抛错
function withTimeout(p, ms, fallback) {
  return Promise.race([
    p,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function getCookie(ctx) {
  let c = "";
  try {
    const h = ctx.request.headers;
    if (h) {
      if (typeof h.get === "function") c = h.get("cookie") || "";
      if (!c) c = h["cookie"] || h["Cookie"] || "";
    }
  } catch (e) {}
  if (!c && ctx.env.JD_COOKIE) c = String(ctx.env.JD_COOKIE).trim();
  return c;
}

// ---------- 京粉转链 ----------

async function convert(ctx, url, cookie, autoScheme, isOriginJXURL) {
  if (!cookie) return "转链无 Cookie：请在模块参数 JD_COOKIE 里填京粉账号的 Cookie";
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
