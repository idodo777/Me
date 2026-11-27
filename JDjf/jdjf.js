// 京东京粉全功能（Egern 版）1.0 诊断版
// 上游作者：Tartarus2014（脚本）/ sempliciy（Surge 模块）；unionId 写法参照 x-dr/ntchat_code api/jd.py
// 上游更新：脚本 2021-11-03；模块 2022-06-08
// 拦截数量：3（api.m.jd.com、api-dd.jd.com、union.jd.com）
// 脚本数量：3（本文件：wskey 捕获 + 一键转京粉返利链接；jd-wskey.js 备用只盯 api-dd；jd-union.js 京粉 CK 捕获）
// 上游来源：https://github.com/sempliciy/Quantumult-X/blob/master/Surge/JD_Pirce.sgmodule
// 脚本来源：https://github.com/Tartarus2014/Script/blob/master/jf_Convert.js
//          https://github.com/githubdulong/Script/blob/master/Surge/JDWSKey.sgmodule
//          https://github.com/x-dr/ntchat_code/blob/main/api/jd.py（unionId 写法）
// 用法：打开京东商品详情，弹一条返利通知，点通知一键跳转到返利后的商品页；
//   打开京东 App 即抓 wskey，自动同步到青龙；打开京东联盟（京粉 App / union.jd.com）即抓京粉 CK 供转链用。
// Cookie：转链优先用模块参数 JD_COOKIE，其次已捕获的京粉 CK，再用本次请求的 Cookie，最后用已捕获的 wskey 拼。
// 联盟 ID：京粉 App → 我的 → 昵称下方的数字，填进模块参数 JD_UNION_ID；
//   上游 Tartarus 的脚本不传 unionId（靠服务器从 Cookie 反查账号），
//   ntchat 的可用实现是在 body 顶层传 unionId，本版照此加，无 ID 时不传。
// 注意：转链只对已开通京东联盟（京粉）的账号生效；未开通会提示“暂无返利信息”。
// 0.9 改动（2026-11-27 用户令 + 0.8 零通知返修）：
//   ① 加 JD_UNION_ID 参数，转链 body 顶层带 unionId；
//   ② 加京粉 CK 捕获（jd-union.js 盯 union.jd.com；本文件在联盟接口请求里也顺手抓一份）；
//      上游没有现成的捕获脚本（BoxJS 的 jfCookie / lkJdHelperCk 都是手填），这是新加的；
//   ③ 0.8 转链零通知返修：match 改 host 级（functionId 在脚本内判断），
//      wskey 捕获与转链合并为单脚本、body 只读一次。

// 1.0 诊断版（2026-11-27 21:19 用户实测报“商品响应解析失败”）：解析失败时通知里带上
//   状态码、响应体长度、functionId 与前 60 字，先看清响应到底是什么再修；其余逻辑与 0.9 相同。

export default async function (ctx) {
  const url = String((ctx.request && ctx.request.url) || "");
  let cookie = "";
  try {
    const h = ctx.request.headers;
    if (h) {
      if (typeof h.get === "function") cookie = h.get("cookie") || "";
      if (!cookie) cookie = h["cookie"] || h["Cookie"] || "";
    }
  } catch (e) {}
  // body 只读一次：wskey 的 pin 与商品解析共用这份文本
  let bodyText = "";
  try {
    bodyText = await ctx.response.text();
  } catch (e) {}

  // ① wskey 捕获（JDWSKEY 开关）：每次请求都跑
  if (ctx.env && ctx.env.JDWSKEY === "true") {
    await captureWskey(ctx, url, bodyText, cookie);
  }

  // ② 京粉 CK 捕获：联盟接口请求（京粉 App 的 union / jingfen 接口）顺手抓
  if (/union|jingfen/i.test(url) && cookie) {
    saveUnionCookie(ctx, cookie);
  }

  // ③ 商品页才转链
  const isWare = url.includes("wareBusiness") || url.includes("pingou_item");
  if (!isWare) return;
  if ((ctx.env.JF_CONVERT ?? "true") === "false") return;

  let obj;
  try {
    obj = JSON.parse(bodyText);
  } catch (e) {
    // 诊断版：报清状态码、长度、functionId 与响应头 60 字，定位到底是空响应、验证页还是编码问题
    let st = "?";
    try {
      st = String(ctx.response && ctx.response.status);
    } catch (e2) {}
    let fid = "?";
    try {
      const fm = url.match(/functionId=([^&]+)/);
      if (fm) fid = fm[1];
    } catch (e2) {}
    const len = bodyText ? bodyText.length : 0;
    const head = bodyText ? bodyText.replace(/[\r\n\t]+/g, " ").slice(0, 60) : "";
    ctx.notify({
      title: "京东京粉转链",
      body: `解析失败：status=${st} 长度=${len} ${fid}「${head || "（空）"}」`,
    });
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
  const convCookie = getConvertCookie(ctx, cookie);

  // 转链 4 秒硬超时：挂住也不拖死通知
  let conv = await withTimeout(convert(ctx, shareUrl, convCookie, autoScheme, false), 4000, "TIMEOUT");
  if (conv === "useJXOrigin" && isPingou) {
    conv = await withTimeout(convert(ctx, shareUrl, convCookie, autoScheme, true), 4000, "TIMEOUT");
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
}

// 任意 promise 超时即返回 fallback，不抛错
function withTimeout(p, ms, fallback) {
  return Promise.race([
    p,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// ---------- wskey 捕获（与 jd-wskey.js v4 同逻辑，改走传入的 bodyText） ----------

async function captureWskey(ctx, url, bodyText, cookie) {
  const SYNC_URL = (ctx.env.CK_SYNC_URL || "").replace(/\/+$/, "");
  const TOKEN = ctx.env.CK_SYNC_TOKEN || "";

  const now = Date.now();
  const NOTIFY_GAP = 3600000; // 1 小时
  function throttled(kind) {
    try {
      const last = Number(ctx.storage.get("jd_wskey_notify_" + kind) || 0);
      if (now - last < NOTIFY_GAP) return true;
      ctx.storage.set("jd_wskey_notify_" + kind, String(now));
      return false;
    } catch (e) {
      return false;
    }
  }
  function loadPiece(key) {
    try {
      return ctx.storage.get(key) || "";
    } catch (e) {
      return "";
    }
  }
  function savePiece(key, val) {
    try {
      ctx.storage.set(key, val);
    } catch (e) {}
  }

  let wskey = "";
  const wskeyMatch = cookie.match(/wskey=([^;]+)/);
  if (wskeyMatch) wskey = wskeyMatch[1];

  let pin = "";
  if (bodyText) {
    // 1. 响应体 userInfoSns
    try {
      const obj = JSON.parse(bodyText);
      const sns = obj && obj.userInfoSns ? obj.userInfoSns : null;
      if (sns) {
        pin = sns.pin || sns.unickName || "";
        try {
          pin = decodeURIComponent(pin);
        } catch (e) {}
      }
    } catch (e) {}
    // 2. 响应体里的 pin 字段（双重转义的先在原文里找，找不到再去掉反斜杠找）
    if (!pin) {
      const tryPin = (t) => {
        const m =
          t.match(/"pin"\s*:\s*"([^"]+)"/) ||
          t.match(/\$pin=([A-Za-z0-9_]+)/) ||
          t.match(/[?&]pin=([^&"']+)/);
        return m ? m[1] : "";
      };
      pin = tryPin(bodyText) || tryPin(bodyText.replace(/\\/g, ""));
    }
  }
  // 3. 请求 URL 里的 pin= 参数
  if (!pin) {
    try {
      const m = url.match(/[?&]pin=([^&]+)/);
      if (m) pin = decodeURIComponent(m[1]);
    } catch (e) {}
  }
  // 4. Cookie 里的 pt_pin
  if (!pin) {
    const m = cookie.match(/pt_pin=([^;]+)/);
    if (m) {
      try {
        pin = decodeURIComponent(m[1]);
      } catch (e) {
        pin = m[1];
      }
    }
  }

  // 跨请求凑齐：各存各的
  let savedWskey = loadPiece("jd_wskey_piece") || loadPiece("jd_wskey_pending") || "";
  let savedPin = loadPiece("jd_pin_piece") || "";
  if (wskey) savedWskey = wskey;
  if (pin) savedPin = pin;
  if (wskey) savePiece("jd_wskey_piece", savedWskey);
  if (pin) savePiece("jd_pin_piece", savedPin);

  // 齐了就上传
  if (savedWskey && savedPin) {
    const value = "pin=" + savedPin + ";wskey=" + savedWskey + ";";
    const storeKey = "jd_wskey_" + savedPin;
    let old = null;
    try {
      old = ctx.storage.get(storeKey);
    } catch (e) {}
    if (old === value) {
      if (!throttled("same")) {
        ctx.notify({ title: "京东 wskey 已是最新", body: "账号 " + savedPin + " 的 wskey 未变，无需同步" });
      }
      return;
    }
    try {
      ctx.storage.set(storeKey, value);
    } catch (e) {}

    if (!SYNC_URL) {
      ctx.notify({ title: "京东 wskey 已抓取", body: "未填同步服务器地址，请在模块设置里填 CK_SYNC_URL" });
      return;
    }
    if (!TOKEN) {
      ctx.notify({ title: "京东 wskey 已抓取", body: "未填同步口令，请在模块设置里填 CK_SYNC_TOKEN" });
      return;
    }

    try {
      const res = await ctx.http.post(SYNC_URL + "/jd-wskey", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, pin: savedPin, wskey: savedWskey }),
      });
      const data = JSON.parse(await res.text());
      if (data && data.ok) {
        ctx.notify({
          title: "京东 wskey 已同步",
          body:
            "账号 " +
            savedPin +
            " 已写入青龙" +
            (data.convert_triggered ? "，正在转换" : "（转换任务触发失败，请看青龙任务 413）"),
        });
      } else {
        ctx.notify({ title: "京东 wskey 同步失败", body: (data && data.error) || "服务器返回异常" });
      }
    } catch (e) {
      ctx.notify({
        title: "京东 wskey 同步失败",
        body: "连不上服务器：" + (e && e.message ? e.message : String(e)),
      });
    }
    return;
  }

  // 还没齐：报一半的进度（节流 1 小时）
  if (savedWskey && !savedPin) {
    if (!throttled("half_wskey")) {
      ctx.notify({ title: "京东 wskey 已抓取", body: "wskey 已抓到，正在等带 pin 的请求来凑齐账号" });
    }
    return;
  }
  if (!savedWskey && savedPin) {
    if (!throttled("half_pin")) {
      ctx.notify({ title: "京东 wskey 未抓到", body: "已取到账号 " + savedPin + "，正在等带 wskey 的请求" });
    }
    return;
  }
  if (!throttled("miss")) {
    ctx.notify({ title: "京东 wskey 未抓到", body: "本次请求里没有 wskey，确认已登录京东" });
  }
}

// ---------- 京粉 CK 捕获（联盟接口请求顺手抓） ----------

function saveUnionCookie(ctx, cookie) {
  try {
    const old = ctx.storage.get("jd_union_cookie") || "";
    if (old === cookie) return;
    ctx.storage.set("jd_union_cookie", cookie);
    ctx.notify({ title: "京粉 CK 已捕获", body: "已存好，转链会优先用这份 Cookie" });
  } catch (e) {}
}

// ---------- 转链 Cookie 优先级 ----------

function getConvertCookie(ctx, requestCookie) {
  try {
    if (ctx.env.JD_COOKIE && String(ctx.env.JD_COOKIE).trim()) {
      return String(ctx.env.JD_COOKIE).trim();
    }
  } catch (e) {}
  try {
    const u = ctx.storage.get("jd_union_cookie") || "";
    if (u) return u;
  } catch (e) {}
  if (requestCookie) return requestCookie;
  try {
    const ws = ctx.storage.get("jd_wskey_piece") || "";
    const pin = ctx.storage.get("jd_pin_piece") || "";
    if (ws && pin) return "pin=" + pin + ";wskey=" + ws + ";";
    if (ws) return "wskey=" + ws + ";";
  } catch (e) {}
  return "";
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
