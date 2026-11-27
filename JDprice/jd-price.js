// 京东比价 + 京粉返利（Egern 原生版）
// 上游参照: Tartarus2014/Script jdjf_price.js（Surge 版）
// 改动:
//   1. Surge/BoxJS 写法改写为 Egern 原生 ctx 写法；
//   2. 设置走模块 env_schema（JDPRICE 开关、JFCOOKIE 京粉 Cookie），不再依赖 BoxJS；
//   3. 通知只发标题+正文（Egern 通知不支持点按跳转）；
//   4. 原脚本的比价逻辑只在 QuanX 下跑，Egern 版取消该限制；
//   5. 删掉未使用的 Array.prototype.insert。
// 功能: 打开京东商品详情时，推送历史最低价（慢慢买）+ 京粉返利信息；同时清理 serverConfig/basicConfig 里的 httpdns。
// 返利需要京粉 Cookie（JFCOOKIE），没有则只显示历史价。
export default async function (ctx) {
  if (!(ctx.env && ctx.env.JDPRICE === "true")) return {};

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

  // 商品详情：历史价 + 京粉返利，通知推送，正文原样返回
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
        requestHistoryPrice(ctx, shareUrl),
        useConvert ? convertLink(ctx, shareUrl, cookie, false) : Promise.resolve(""),
        url.indexOf("pingou_item") !== -1 && useConvert ? convertLink(ctx, shareUrl, cookie, true) : Promise.resolve(""),
      ]);
      let history = results[0];
      let conv = results[1];
      if (conv === "useJXOrigin") conv = results[2];
      let msg = "";
      if (history && history.lower_tip) {
        msg += history.lower_tip;
        const convertmsg = conv && conv.convertURL !== undefined ? conv.msg : conv;
        msg += convertmsg ? convertmsg : "😤 该商品暂无返利";
      } else {
        const convertmsg = conv && conv.convertURL !== undefined ? conv.msg : conv;
        msg += convertmsg ? convertmsg : "";
        msg += history || "";
      }
      if (msg) {
        ctx.notify({ title: "京东价格/返利", body: msg });
      }
      return {};
    } catch (e) {
      return {};
    }
  }

  return {};
}

function lowerMsgs(data) {
  const lower = data.lowerPriceyh;
  const lowerDate = dateFormat(data.lowerDateyh);
  return "〽️ 历史最低 ➩ " + String(lower) + " ║" + "🗓 " + lowerDate;
}

function priceSummary(data) {
  let summary = "";
  const listPriceDetail = data.PriceRemark.ListPriceDetail.slice(0, 4);
  const list = listPriceDetail.concat(historySummary(data.single));
  list.forEach((item) => {
    if (item.Name === "双11价格") item.Name = "双十一价格";
    else if (item.Name === "618价格") item.Name = "六一八价格";
    const price = String(parseInt(item.Price.substr(1)));
    summary += "\n" + item.Name + "   " + (isNaN(price) ? "-" : "¥" + price) + "   " + item.Date + "   " + item.Difference;
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
      const price = parseFloat(result[2]);
      if (index === 0) {
        currentPrice = price;
        lowest30 = { Name: "三十天最低", Price: "¥" + String(price), Date: date, Difference: difference(currentPrice, price), price };
        lowest90 = { Name: "九十天最低", Price: "¥" + String(price), Date: date, Difference: difference(currentPrice, price), price };
        lowest180 = { Name: "一百八最低", Price: "¥" + String(price), Date: date, Difference: difference(currentPrice, price), price };
        lowest360 = { Name: "三百六最低", Price: "¥" + String(price), Date: date, Difference: difference(currentPrice, price), price };
      }
      if (index < 30 && price < lowest30.price) {
        lowest30.price = price;
        lowest30.Price = "¥" + String(price);
        lowest30.Date = date;
        lowest30.Difference = difference(currentPrice, price);
      }
      if (index < 90 && price < lowest90.price) {
        lowest90.price = price;
        lowest90.Price = "¥" + String(price);
        lowest90.Date = date;
        lowest90.Difference = difference(currentPrice, price);
      }
      if (index < 180 && price < lowest180.price) {
        lowest180.price = price;
        lowest180.Price = "¥" + String(price);
        lowest180.Date = date;
        lowest180.Difference = difference(currentPrice, price);
      }
      if (index < 360 && price < lowest360.price) {
        lowest360.price = price;
        lowest360.Price = "¥" + String(price);
        lowest360.Date = date;
        lowest360.Difference = difference(currentPrice, price);
      }
    }
  });
  return [lowest30, lowest90, lowest180];
}

function difference(currentPrice, price) {
  const diff = sub(currentPrice, price);
  if (diff === 0) return "-";
  return (diff > 0 ? "↑" : "↓") + String(diff);
}

function sub(arg1, arg2) {
  return add(arg1, -Number(arg2), arguments[2]);
}

function add(arg1, arg2) {
  arg1 = arg1.toString();
  arg2 = arg2.toString();
  const arg1Arr = arg1.split(".");
  const arg2Arr = arg2.split(".");
  const d1 = arg1Arr.length === 2 ? arg1Arr[1] : "";
  const d2 = arg2Arr.length === 2 ? arg2Arr[1] : "";
  const maxLen = Math.max(d1.length, d2.length);
  const m = Math.pow(10, maxLen);
  const result = Number(((arg1 * m + arg2 * m) / m).toFixed(maxLen));
  const d = arguments[2];
  return typeof d === "number" ? Number(result.toFixed(d)) : result;
}

async function requestHistoryPrice(ctx, shareUrl) {
  try {
    const res = await ctx.http.post("https://apapia-history.manmanbuy.com/ChromeWidgetServices/WidgetServices.ashx", {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 13_1_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 - mmbWebBrowse - ios",
      },
      body: "methodName=getHistoryTrend&p_url=" + encodeURIComponent(shareUrl),
    });
    const data = JSON.parse(await res.text());
    if (data.ok == 1 && data.single) {
      const r = {};
      r.lower_tip = lowerMsgs(data.single) + "\n";
      r.historydetail = priceSummary(data).substr(1);
      return r;
    }
    if (data.ok == 0 && data.msg && data.msg.length > 0) {
      return "😳 " + data.msg;
    }
    return "";
  } catch (e) {
    return "";
  }
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
        return { msg: "💴 预计返利 ➩ " + data.data.wlCommission + " ║🏷 返利率 ➩ " + data.data.wlCommissionShare + "%" };
      }
      return { msg: "😤 该商品暂无详细返利，" + (data.data.formatContext || "").trim() };
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

function dateFormat(cellval) {
  const date = new Date(parseInt(cellval.replace("/Date(", "").replace(")/", ""), 10));
  const month = date.getMonth() + 1 < 10 ? "0" + (date.getMonth() + 1) : date.getMonth() + 1;
  const currentDate = date.getDate() < 10 ? "0" + date.getDate() : date.getDate();
  return date.getFullYear() + "-" + month + "-" + currentDate;
}

Date.prototype.format = function (fmt) {
  const o = {
    "y+": this.getFullYear(),
    "M+": this.getMonth() + 1,
    "d+": this.getDate(),
    "h+": this.getHours(),
    "m+": this.getMinutes(),
    "s+": this.getSeconds(),
    "q+": Math.floor((this.getMonth() + 3) / 3),
    "S+": this.getMilliseconds(),
  };
  for (const k in o) {
    if (new RegExp("(" + k + ")").test(fmt)) {
      if (k === "y+") {
        fmt = fmt.replace(RegExp.$1, ("" + o[k]).substr(4 - RegExp.$1.length));
      } else if (k === "S+") {
        let lens = RegExp.$1.length;
        lens = lens === 1 ? 3 : lens;
        fmt = fmt.replace(RegExp.$1, ("00" + o[k]).substr(("" + o[k]).length - 1, lens));
      } else {
        fmt = fmt.replace(RegExp.$1, RegExp.$1.length === 1 ? o[k] : ("00" + o[k]).substr(("" + o[k]).length));
      }
    }
  }
  return fmt;
};
