// 京粉转链（Egern 原生版）
// 上游参照: Tartarus2014/Script jf_Convert.js（Surge 版）
// 改动:
//   1. Surge/BoxJS 写法改写为 Egern 原生 ctx 写法；
//   2. 设置走模块 env_schema（JFCONVERT 开关、JFCOOKIE 京粉 Cookie），不再依赖 BoxJS；
//   3. 通知只发标题+正文（Egern 通知不支持点按跳转）；
//   4. 原脚本的转链逻辑只在 QuanX 下跑，Egern 版取消该限制。
// 功能: 打开京东商品详情时，把商品链接转成京粉返利链接，推送返利比率与预计返利；同时清理 serverConfig/basicConfig 里的 httpdns。
// 需要京粉 Cookie（JFCOOKIE），没有则不转链。
export default async function (ctx) {
  if (!(ctx.env && ctx.env.JFCONVERT === "true")) return {};

  const url = ctx.request.url || "";
  let body = "";
  try {
    body = await ctx.response.text();
  } catch (e) {
    return {};
  }

  const cookie = (ctx.env.JFCOOKIE || "") || (ctx.storage.get("jfCookie") || "");
  const useConvert = ctx.storage.get("jfUseConvert") !== "false";

  // serverConfig：清 httpdns
  if (url.indexOf("serverConfig") !== -1) {
    try {
      const obj = JSON.parse(body);
      if (obj.serverConfig) {
        delete obj.serverConfig.httpdns;
        delete obj.serverConfig.dnsvip;
        delete obj.serverConfig.dnsvip_v6;
      }
      return { response: { body: JSON.stringify(obj) } };
    } catch (e) {
      return {};
    }
  }

  // basicConfig：清 httpdns
  if (url.indexOf("basicConfig") !== -1) {
    try {
      const obj = JSON.parse(body);
      if (obj.data) {
        if (obj.data.JDHttpToolKit) {
          delete obj.data.JDHttpToolKit.httpdns;
          delete obj.data.JDHttpToolKit.dnsvipV6;
        }
        if (obj.data.jCommandConfig) {
          delete obj.data.jCommandConfig.httpdnsConfig;
        }
      }
      return { response: { body: JSON.stringify(obj) } };
    } catch (e) {
      return {};
    }
  }

  // 商品详情：京粉转链，通知推送，正文原样返回
  if (url.indexOf("wareBusiness") !== -1 || url.indexOf("pingou_item") !== -1) {
    try {
      const obj = JSON.parse(body);
      const floors = obj.floors || [];
      const commodity_info = floors[floors.length - 1] || {};
      const others = obj.others || {};
      const domain = obj.domain || {};
      let shareUrl = "";
      if (url.indexOf("pingou_item") !== -1) {
        shareUrl = domain.h5Url || "";
      } else if (url.indexOf("wareBusiness.style") !== -1) {
        shareUrl = (others.property && others.property.shareUrl) || "";
      } else {
        shareUrl = (commodity_info.data && commodity_info.data.property && commodity_info.data.property.shareUrl) || "";
      }
      if (!shareUrl) return {};

      const results = await Promise.all([
        useConvert ? convertLink(ctx, shareUrl, cookie, false) : Promise.resolve(""),
        url.indexOf("pingou_item") !== -1 && useConvert ? convertLink(ctx, shareUrl, cookie, true) : Promise.resolve(""),
      ]);
      let conv = results[0];
      if (conv === "useJXOrigin") conv = results[1];
      let msg = "";
      if (conv && conv.msg) {
        msg = conv.msg;
      } else if (typeof conv === "string" && conv) {
        msg = conv;
      } else {
        msg = "该商品暂无详细返利信息";
      }
      if (msg) {
        ctx.notify({ title: "京粉转链", body: msg });
      }
      return {};
    } catch (e) {
      return {};
    }
  }

  return {};
}

async function convertLink(ctx, shareUrl, cookie, isOriginJXURL) {
  if (!cookie) {
    try { ctx.storage.set("jfUseConvert", "false"); } catch (e) {}
    return "";
  }
  let url = shareUrl;
  let autoScheme = "openjd";
  try {
    let id;
    if (url.includes("item.m.jd") || url.includes("item.jd")) {
      id = url.match(/(\d+)\.html/)[1];
      url = "https://item.m.jd.com/product/" + id + ".html";
    } else if (url.includes("m.jingxi") || url.includes("wq.jd.com")) {
      id = url.match(/sku=(\d+)/)[1];
      url = "https://wq.jd.com/item/view?sku=" + id;
      if (isOriginJXURL) url = "https://m.jingxi.com/item/jxview?sku=" + id;
      autoScheme = "openapp.jdpingou";
    } else if (url.includes("kpl.m.jd")) {
      id = url.match(/wareId=(\d+)/)[1];
      url = "https://kpl.m.jd.com/product?wareId=" + id;
      autoScheme = "browser";
    }
  } catch (e) {
    return "";
  }
  const apiUrl =
    "https://api.m.jd.com/api?functionId=ConvertSuperLink&appid=u&_=" + Date.now() +
    "&body=" + encodeURI(JSON.stringify({ funName: "getSuperClickUrl", param: { materialInfo: url, ext1: "200|100_3|" } })) +
    "&loginType=2";
  try {
    const res = await ctx.http.get(apiUrl, {
      headers: {
        "Accept-Encoding": "gzip,compress,br,deflate",
        "Connection": "keep-alive",
        "Cookie": cookie,
        "Host": "api.m.jd.com",
        "Referer": "https://servicewechat.com/wxf463e50cd384beda/114/page-frame.html",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 13_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.4(0x18000429) NetType/WIFI Language/zh_CN",
        "content-type": "application/json",
      },
    });
    const data = JSON.parse(await res.text());
    if (data.code === 200) {
      if (data.data.promotionUrl) {
        return { msg: "💰返点比率：" + data.data.wlCommissionShare + " %    预计返利：¥ " + data.data.wlCommission };
      }
      return { msg: "该商品暂无详细返利信息，" + (data.data.formatContext || "").trim() };
    }
    if (data.code === 105) {
      return autoScheme === "openapp.jdpingou" ? "useJXOrigin" : "";
    }
    if (data.code === 430) {
      try { ctx.storage.set("jfUseConvert", "false"); } catch (e) {}
      return "";
    }
    return JSON.stringify(data);
  } catch (e) {
    return "";
  }
}
