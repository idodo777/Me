// 京东联盟 CK 捕获（Egern 版）
// 上游没有现成的捕获脚本（BoxJS 的 jfCookie / lkJdHelperCk 都是手填）；本脚本是新增的。
// 触发：打开京东联盟站 union.jd.com 任一页面（须已登录京东联盟账号）；
//   抓到新的 Cookie 就存起来给转链用，并弹提醒；已是最新则节流提醒。
// 注意：京粉 App 自身的接口走 api.m.jd.com，由 jdjf.js 在联盟接口请求里顺手抓，本脚本只补网页版联盟站。
export default async function (ctx) {
  // 京粉 CK 捕获开关（JDUNION，1.2）：关了就静默返回，不抓也不弹；默认开，抓到后用户手动关
  try {
    if (ctx.env && ctx.env.JDUNION === "false") return {};
  } catch (e) {}
  const now = Date.now();
  const GAP = 3600000; // 1 小时
  function throttled(kind) {
    try {
      const last = Number(ctx.storage.get("jd_union_notify_" + kind) || 0);
      if (now - last < GAP) return true;
      ctx.storage.set("jd_union_notify_" + kind, String(now));
      return false;
    } catch (e) {
      return false;
    }
  }

  let cookie = "";
  try {
    const h = ctx.request.headers;
    if (h) {
      if (typeof h.get === "function") cookie = h.get("cookie") || "";
      if (!cookie) cookie = h["cookie"] || h["Cookie"] || "";
    }
  } catch (e) {}

  if (!cookie || !/pt_key|wskey|pt_pin/.test(cookie)) {
    if (!throttled("miss")) {
      ctx.notify({ title: "京粉 CK 未抓到", body: "本次请求里没有京东登录凭证，请先在联盟站登录京东账号" });
    }
    return {};
  }

  let old = "";
  try {
    old = ctx.storage.get("jd_union_cookie") || "";
  } catch (e) {}
  if (old === cookie) {
    if (!throttled("same")) {
      ctx.notify({ title: "京粉 CK 已是最新", body: "联盟站 Cookie 未变，转链继续用它" });
    }
    return {};
  }
  try {
    ctx.storage.set("jd_union_cookie", cookie);
  } catch (e) {}
  ctx.notify({ title: "京粉 CK 已捕获", body: "已存好，转链会优先用这份 Cookie" });
  return {};
}
