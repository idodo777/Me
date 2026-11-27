// 京东 wskey 抓取 + 自动同步到青龙（Egern 原生版）
// 上游参照: githubdulong/Script JDWSKey.js（Surge 版，更新 2024-04-28）
// 改动:
//   1. Surge Env 桥接改写为 Egern 原生 ctx 写法；
//   2. 上传目标由 Telegram Bot 改为自家服务器接收器（POST /jd-wskey），
//      服务器收到后自动写青龙 JD_WSCK 并触发 wskey 转换；
//   3. pin 优先取响应体 userInfoSns.pin，取不到再用 unickName（上游原法）。
//   4. 每次触发都有通知：抓到/未变/未抓到/同步成功/同步失败，绝不静默。
//      响应里没有 pt_pin（App Cookie 只有 wskey），pin 只能从响应体拿。
// 触发: 打开京东 App / 个人中心下拉刷新时，newUserInfo 请求即抓取；wskey 没变不重复传。
// 注意: 同步服务器地址与口令不在本文件里，由用户在模块设置页填写（CK_SYNC_URL / CK_SYNC_TOKEN）。
export default async function (ctx) {
  if (!(ctx.env && ctx.env.JDWSKEY === "true")) return {};

  const SYNC_URL = (ctx.env.CK_SYNC_URL || "").replace(/\/+$/, "");
  const TOKEN = ctx.env.CK_SYNC_TOKEN || "";

  let cookie = "";
  try {
    cookie = ctx.request.headers.get("cookie") || ctx.request.headers.get("Cookie") || "";
  } catch (e) {}

  const wskeyMatch = cookie.match(/wskey=([^;]+)/);
  const wskey = wskeyMatch ? wskeyMatch[1] : "";

  let pin = "";
  try {
    const body = JSON.parse(await ctx.response.text());
    const sns = body && body.userInfoSns ? body.userInfoSns : null;
    if (sns) {
      pin = sns.pin || sns.unickName || "";
      try { pin = decodeURIComponent(pin); } catch (e) {}
    }
  } catch (e) {}

  if (!pin || !wskey) {
    ctx.notify({ title: "京东 wskey 未抓到", body: "本次请求里没有 wskey，确认已登录京东并打开个人中心下拉刷新" });
    return {};
  }

  const value = "pin=" + pin + ";wskey=" + wskey + ";";
  const storeKey = "jd_wskey_" + pin;
  let old = null;
  try { old = ctx.storage.get(storeKey); } catch (e) {}
  if (old === value) {
    ctx.notify({ title: "京东 wskey 已是最新", body: "账号 " + pin + " 的 wskey 未变，无需同步" });
    return {};
  }
  try { ctx.storage.set(storeKey, value); } catch (e) {}

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
        body: "账号 " + pin + " 已写入青龙" + (data.convert_triggered ? "，正在转换" : "（转换任务触发失败，请看青龙任务 413）"),
      });
    } else {
      ctx.notify({ title: "京东 wskey 同步失败", body: (data && data.error) || "服务器返回异常" });
    }
  } catch (e) {
    ctx.notify({ title: "京东 wskey 同步失败", body: "连不上服务器：" + (e && e.message ? e.message : String(e)) });
  }
  return {};
}
