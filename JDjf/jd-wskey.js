// 京东 wskey 抓取 + 自动同步到青龙（Egern 原生版）
// 上游参照: githubdulong/Script JDWSKey.js（Surge 版，更新 2024-04-28）
// 改动:
//   1. Surge Env 桥接改写为 Egern 原生 ctx 写法；
//   2. 上传目标由 Telegram Bot 改为自家服务器接收器（POST /jd-wskey），
//      服务器收到后自动写青龙 JD_WSCK 并触发 wskey 转换；
//   3. pin 优先取响应体 userInfoSns.pin，取不到再用 unickName（上游原法）。
//      响应里没有 pt_pin（App Cookie 只有 wskey），pin 只能从响应体拿。
//   4. 每次触发都有通知：抓到/未变/未抓到/同步成功/同步失败，绝不静默。
//   5. 触发改宽（2026-11-27 HAR 实锤）：京东 App 16.1.90 启动/首页全程没调
//      newUserInfo（只在 basicConfig 响应里出现过这个名字），原先只盯
//      newUserInfo 的写法永远触发不了。现改盯 api.m.jd.com 全站请求，
//      只要请求 Cookie 里有 wskey 就抓；pin 从响应体里取（userInfoSns 或
//      "pin":"xxx" / $pin=xxx），取不到先存 wskey 待匹配。
//   6. 提醒节流：wskey 没变 / 没抓到 / 只有 wskey 没 pin 时，每小时最多提醒一次，
//      避免每个请求都弹。上传成功/失败每次都提醒（只在 wskey 变化时才上传）。
// 触发: 打开京东 App 即抓（首页请求就带 wskey）；wskey 没变不重复传。
// 注意: 同步服务器地址与口令不在本文件里，由用户在模块设置页填写（CK_SYNC_URL / CK_SYNC_TOKEN）。
export default async function (ctx) {
  if (!(ctx.env && ctx.env.JDWSKEY === "true")) return {};

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

  let cookie = "";
  try {
    cookie = ctx.request.headers.get("cookie") || ctx.request.headers.get("Cookie") || "";
  } catch (e) {}

  const wskeyMatch = cookie.match(/wskey=([^;]+)/);
  const wskey = wskeyMatch ? wskeyMatch[1] : "";

  let pin = "";
  let bodyText = "";
  try {
    bodyText = await ctx.response.text();
  } catch (e) {}
  if (bodyText) {
    // 1. 响应体 userInfoSns（原 newUserInfo 路）
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
    // 2. 响应体里的 pin 字段（HAR 实锤：secondFloor 响应 "pin":"393222200"，
    //    uniformRecommend9c 响应 $pin=393222200；secondFloor 那份是双重转义的，
    //    先在原文里找，找不到再去掉反斜杠找）
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
      const m = String(ctx.request.url || "").match(/[?&]pin=([^&]+)/);
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

  if (!wskey) {
    if (!throttled("miss")) {
      ctx.notify({ title: "京东 wskey 未抓到", body: "本次请求里没有 wskey，确认已登录京东" });
    }
    return {};
  }

  if (!pin) {
    // wskey 抓到了但 pin 不明：先存起来，等有 pin 的请求再补
    try {
      const oldPending = ctx.storage.get("jd_wskey_pending") || "";
      if (oldPending !== wskey) {
        ctx.storage.set("jd_wskey_pending", wskey);
        if (!throttled("nopin")) {
          ctx.notify({ title: "京东 wskey 已抓取", body: "wskey 已抓到，正在等带 pin 的请求来匹配账号" });
        }
      }
    } catch (e) {}
    return {};
  }

  const value = "pin=" + pin + ";wskey=" + wskey + ";";
  const storeKey = "jd_wskey_" + pin;
  let old = null;
  try {
    old = ctx.storage.get(storeKey);
  } catch (e) {}
  if (old === value) {
    if (!throttled("same")) {
      ctx.notify({ title: "京东 wskey 已是最新", body: "账号 " + pin + " 的 wskey 未变，无需同步" });
    }
    return {};
  }
  try {
    ctx.storage.set(storeKey, value);
  } catch (e) {}

  if (!SYNC_URL) {
    ctx.notify({ title: "京东 wskey 已抓取", body: "未填同步服务器地址，请在模块设置里填 CK_SYNC_URL" });
    return {};
  }

  if (!TOKEN) {
    ctx.notify({ title: "京东 wskey 已抓取", body: "未填同步口令，请在模块设置里填 CK_SYNC_TOKEN" });
    return {};
  }

  try {
    const res = await ctx.http.post(SYNC_URL + "/jd-wskey", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN, pin: pin, wskey: wskey }),
    });
    const data = JSON.parse(await res.text());
    if (data && data.ok) {
      ctx.notify({
        title: "京东 wskey 已同步",
        body:
          "账号 " +
          pin +
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
  return {};
}
