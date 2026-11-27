// 京东京粉转链（Egern 版）0.7
// 上游作者：Tartarus2014（脚本）/ sempliciy（Surge 模块）
// 上游更新：脚本 2021-11-03；模块 2022-06-08
// 拦截数量：1（api.m.jd.com）
// 脚本数量：1（本文件，合并上游 jdjf_price.js 与 jf_Convert.js）
// 上游来源：https://github.com/sempliciy/Quantumult-X/blob/master/Surge/JD_Pirce.sgmodule
// 脚本来源：https://github.com/Tartarus2014/Script/blob/master/jdjf_price.js
//          https://github.com/Tartarus2014/Script/blob/master/jf_Convert.js
// 用法：打开京东商品详情，弹一条通知（历史最低价 + 返利），点通知一键跳转到返利后的商品页。
// Cookie：默认用京东 App 本次请求的 Cookie；转链失败时在模块参数里填京粉账号的 JD_COOKIE。
// 注意：转链只对已开通京东联盟（京粉）的账号生效；未开通会提示“暂无返利信息”。
// 0.7 改动（2026-11-27 上游全量复核后重写）：
//   ① 上游是“先放行、后台再通知”，Egern 做不到先放行——本版改为双路并行 + 各 4 秒硬超时，
//      任何一路挂住都拖不死通知，打开商品必有一条通知（成功/失败原因都写进通知里，杜绝静默）；
//   ② 历史价源头慢慢买已限流：匿名查返回 ok=0 code 7700“需登录验证”，且单次 6 秒以上，
//      本版超时即放弃、不阻塞转链，通知里只写一行“历史价暂不可用”；
//   ③ 转链 URL 参数改回上游同款 encodeURI；失败时通知里写清 code，不再静默返回空。

export default async function (ctx) {
  try {
    const url = ctx.request.url;
    // 只处理商品详情接口；serverConfig/basicConfig 等配置接口直接放行
    const isWare = url.includes("wareBusiness") || url.includes("pingou_item");
    if (!isWare) return;

    const useConvert = (ctx.env.JF_CONVERT ?? "true") !== "false";
    const usePrice = (ctx.env.JF_PRICE ?? "true") !== "false";
    if (!useConvert && !usePrice) return;

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

    // 双路并行，各 4 秒硬超时：任何一路挂住都不拖死通知
    const [historyMsg, conv] = await Promise.all([
      usePrice ? withTimeout(historyPrice(ctx, shareUrl), 4000, "") : Promise.resolve(""),
      useConvert ? withTimeout(convert(ctx, shareUrl, cookie, autoScheme, false), 4000, "TIMEOUT") : Promise.resolve(""),
    ]);

    let finalConv = conv;
    if (finalConv === "useJXOrigin" && isPingou) {
      finalConv = await withTimeout(convert(ctx, shareUrl, cookie, autoScheme, true), 4000, "TIMEOUT");
    }

    const parts = [];
    if (historyMsg) parts.push(historyMsg);
    let openUrl = "";
    if (finalConv && typeof finalConv === "object") {
      if (finalConv.msg) parts.push(finalConv.msg);
      if (finalConv.convertURL) openUrl = finalConv.convertURL;
    } else if (typeof finalConv === "string" && finalConv) {
      parts.push(finalConv);
    }
    // 两路都空：也弹一条，写清原因，杜绝“打开商品什么都没有”
    const msg = parts.length ? parts.join("\n") : "该商品暂无返利信息（历史价与转链都没返回）";

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

// ---------- 历史比价（慢慢买） ----------
// 注意：慢慢买匿名接口现已限流（ok=0 code 7700“需登录验证”），查不到价是常态，
// 本函数只做 best-effort：超时/限流都返回空或一行提示，绝不阻塞转链。

async function historyPrice(ctx, shareUrl) {
  try {
    const resp = await ctx.http.post(
      "https://apapia-history.manmanbuy.com/ChromeWidgetServices/WidgetServices.ashx",
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 13_1_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 - mmbWebBrowse - ios",
        },
        body: "methodName=getHistoryTrend&p_url=" + encodeURIComponent(shareUrl),
      }
    );
    const data = JSON.parse(await resp.text());
    if (data.ok == 1 && data.single) {
      const lower = lowerMsgs(data.single);
      const detail = priceSummary(data);
      return (lower + "\n" + detail).replace(/^\n+/, "").trim();
    }
    if (data.ok == 0) return "〽️ 历史价暂不可用（慢慢买需登录验证）";
    return "";
  } catch (e) {
    return "";
  }
}

function lowerMsgs(data) {
  const lower = data.lowerPriceyh;
  const lowerDate = dateFormat(data.lowerDateyh);
  return "〽️ 历史最低 ➩ " + String(lower) + " ║" + `🗓 ${lowerDate}`;
}

function priceSummary(data) {
  let summary = "";
  let listPriceDetail = data.PriceRemark.ListPriceDetail.slice(0, 4);
  let list = listPriceDetail.concat(historySummary(data.single));
  list.forEach((item) => {
    if (item.Name == "双11价格") {
      item.Name = "双十一价格";
    } else if (item.Name == "618价格") {
      item.Name = "六一八价格";
    }
    let price = String(parseInt(item.Price.substr(1)));
    summary += `\n${item.Name}   ${isNaN(price) ? "-" : "¥" + price}   ${item.Date}   ${item.Difference}`;
  });
  return summary;
}

function historySummary(single) {
  const rexMatch = /\[.*?\]/g;
  const rexExec = /\[(.*),(.*),"(.*)".*\]/;
  let currentPrice, lowest30, lowest90, lowest180, lowest360;
  let list = single.jiagequshiyh.match(rexMatch);
  list = list.reverse().slice(0, 360);
  list.forEach((item, index) => {
    if (item.length > 0) {
      const result = rexExec.exec(item);
      const dateUTC = new Date(eval(result[1]));
      const date = dateUTC.format("yyyy-MM-dd");
      let price = parseFloat(result[2]);
      if (index == 0) {
        currentPrice = price;
        lowest30 = {
          Name: "三十天最低",
          Price: `¥${String(price)}`,
          Date: date,
          Difference: difference(currentPrice, price),
          price,
        };
        lowest90 = {
          Name: "九十天最低",
          Price: `¥${String(price)}`,
          Date: date,
          Difference: difference(currentPrice, price),
          price,
        };
        lowest180 = {
          Name: "一百八最低",
          Price: `¥${String(price)}`,
          Date: date,
          Difference: difference(currentPrice, price),
          price,
        };
        lowest360 = {
          Name: "三百六最低",
          Price: `¥${String(price)}`,
          Date: date,
          Difference: difference(currentPrice, price),
          price,
        };
      }
      if (index < 30 && price < lowest30.price) {
        lowest30.price = price;
        lowest30.Price = `¥${String(price)}`;
        lowest30.Date = date;
        lowest30.Difference = difference(currentPrice, price);
      }
      if (index < 90 && price < lowest90.price) {
        lowest90.price = price;
        lowest90.Price = `¥${String(price)}`;
        lowest90.Date = date;
        lowest90.Difference = difference(currentPrice, price);
      }
      if (index < 180 && price < lowest180.price) {
        lowest180.price = price;
        lowest180.Price = `¥${String(price)}`;
        lowest180.Date = date;
        lowest180.Difference = difference(currentPrice, price);
      }
      if (index < 360 && price < lowest360.price) {
        lowest360.price = price;
        lowest360.Price = `¥${String(price)}`;
        lowest360.Date = date;
        lowest360.Difference = difference(currentPrice, price);
      }
    }
  });
  return [lowest30, lowest90, lowest180];
}

function difference(currentPrice, price) {
  let diff = sub(currentPrice, price);
  if (diff == 0) {
    return "-";
  } else {
    return `${diff > 0 ? "↑" : "↓"}${String(diff)}`;
  }
}

function sub(arg1, arg2) {
  return add(arg1, -Number(arg2), arguments[2]);
}

function add(arg1, arg2) {
  (arg1 = arg1.toString()), (arg2 = arg2.toString());
  var arg1Arr = arg1.split("."),
    arg2Arr = arg2.split("."),
    d1 = arg1Arr.length == 2 ? arg1Arr[1] : "",
    d2 = arg2Arr.length == 2 ? arg2Arr[1] : "";
  var maxLen = Math.max(d1.length, d2.length);
  var m = Math.pow(10, maxLen);
  var result = Number(((arg1 * m + arg2 * m) / m).toFixed(maxLen));
  var d = arguments[2];
  return typeof d === "number" ? Number(result.toFixed(d)) : result;
}

function dateFormat(cellval) {
  const date = new Date(parseInt(cellval.replace("/Date(", "").replace(")/", ""), 10));
  const month = date.getMonth() + 1 < 10 ? "0" + (date.getMonth() + 1) : date.getMonth() + 1;
  const currentDate = date.getDate() < 10 ? "0" + date.getDate() : date.getDate();
  return date.getFullYear() + "-" + month + "-" + currentDate;
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

Date.prototype.format = function (fmt) {
  var o = {
    "y+": this.getFullYear(),
    "M+": this.getMonth() + 1,
    "d+": this.getDate(),
    "h+": this.getHours(),
    "m+": this.getMinutes(),
    "s+": this.getSeconds(),
    "q+": Math.floor((this.getMonth() + 3) / 3),
    "S+": this.getMilliseconds(),
  };
  for (var k in o) {
    if (new RegExp("(" + k + ")").test(fmt)) {
      if (k == "y+") {
        fmt = fmt.replace(RegExp.$1, ("" + o[k]).substr(4 - RegExp.$1.length));
      } else if (k == "S+") {
        var lens = RegExp.$1.length;
        lens = lens == 1 ? 3 : lens;
        fmt = fmt.replace(RegExp.$1, ("00" + o[k]).substr(("" + o[k]).length - 1, lens));
      } else {
        fmt = fmt.replace(
          RegExp.$1,
          RegExp.$1.length == 1 ? o[k] : ("00" + o[k]).substr(("" + o[k]).length)
        );
      }
    }
  }
  return fmt;
};
