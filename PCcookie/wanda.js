// 【改版 2026-11-27】抓到 CK 即上传青龙接收器（POST /ck，全部上传）；原版只存手机本地。
// 【改版 2026-11-27】每次抓取都有提醒：成功/失败/未变/未填地址口令（绝不静默）。
// wanda · Cookie 抓取（Egern 移植版）
// 原作: MaYIHEI
// 上游来源: https://raw.githubusercontent.com/MaYIHEI/paperclip/refs/heads/main/app/wanda/wanda.cookie.js
// 上游更新日期: 2026-10-19
// 移植说明: 上游脚本逻辑原样保留，仅在外层把 Surge 环境 API 桥接到 Egern ctx。
export default async function (ctx) {
  if (!(ctx.env && ctx.env.WANDA === "true")) return {}; // 本应用开关：在模块设置页打开后才抓取

  // ---------- 环境桥 ----------
  let __request, __response;
  if (ctx.request) {
    const __headers = {};
    const __names = new Set(["cookie", "user-agent", "referer", "content-type", "host", "accept", "accept-language", "x-lf-channel", "authorization", "token"]);
    try { if (typeof ctx.request.headers.forEach === "function") ctx.request.headers.forEach((v, k) => __names.add(String(k).toLowerCase())); } catch (e) {}
    for (const __n of __names) {
      try {
        const __all = typeof ctx.request.headers.getAll === "function" ? ctx.request.headers.getAll(__n) : null;
        if (__all && __all.length > 1) __headers[__n] = __all;
        else { const __v = ctx.request.headers.get(__n); if (__v != null) __headers[__n] = __v; }
      } catch (e) {}
    }
    let __body = "";
    try { __body = await ctx.request.text(); } catch (e) {}
    __request = { url: ctx.request.url, method: ctx.request.method, headers: __headers, body: __body };
  }
  if (ctx.response) {
    const __rh = {};
    try { if (typeof ctx.response.headers.forEach === "function") ctx.response.headers.forEach((v, k) => { __rh[String(k).toLowerCase()] = v; }); } catch (e) {}
    let __rbody = "";
    try { __rbody = await ctx.response.text(); } catch (e) {}
    __response = { status: ctx.response.status, statusCode: ctx.response.status, headers: __rh, body: __rbody };
  }
  const __mk = (method) => (opts, cb) => {
    (async () => {
      try {
        const __o = typeof opts === "string" ? { url: opts } : (opts || {});
        const __init = { headers: __o.headers || {}, timeout: __o.timeout };
        let __resp;
        if (method === "GET") __resp = await ctx.http.get(__o.url, __init);
        else if (method === "POST") __resp = await ctx.http.post(__o.url, { ...__init, body: __o.body });
        else if (method === "PUT") __resp = await ctx.http.put(__o.url, { ...__init, body: __o.body });
        else if (method === "DELETE") __resp = await ctx.http.delete(__o.url, __init);
        else if (method === "PATCH") __resp = await ctx.http.patch(__o.url, { ...__init, body: __o.body });
        else if (method === "HEAD") __resp = await ctx.http.head(__o.url, __init);
        else __resp = await ctx.http.options(__o.url, __init);
        const __text = await __resp.text();
        const __hh = {};
        try { if (__resp.headers && typeof __resp.headers.forEach === "function") __resp.headers.forEach((v, k) => { __hh[k] = v; }); } catch (e) {}
        const __r = { status: __resp.status, statusCode: __resp.status, headers: __hh, body: __text };
        cb(null, __r, __text);
      } catch (e) {
        cb(e && e.message ? e.message : String(e), null, null);
      }
    })();
  };
  globalThis.$httpClient = { get: __mk("GET"), post: __mk("POST"), put: __mk("PUT"), delete: __mk("DELETE"), head: __mk("HEAD"), options: __mk("OPTIONS"), patch: __mk("PATCH") };
  // ---------- CK 同步改版：抓到即上传青龙接收器（只留改版，原版无此段） ----------
  const __CK_APP = "wanda";
  const __CK_NAME = "万达电影";
  const __CK_SYNC_URL = (ctx.env && ctx.env.CK_SYNC_URL ? String(ctx.env.CK_SYNC_URL) : "").replace(/\/+$/, "");
  const __CK_TOKEN = (ctx.env && ctx.env.CK_SYNC_TOKEN) ? String(ctx.env.CK_SYNC_TOKEN) : "";
  function __ckNotify(t, b) { try { ctx.notify({ title: t, body: b }); } catch (e) {} }
  function __ckUpload(v, k) {
    try {
      const __val = v == null ? "" : String(v);
      if (__val.length < 16) return;
      const __key = String(k || "");
      const __kl = __key.toLowerCase();
      if (__kl.indexOf("status") !== -1 || __kl.indexOf("registry") !== -1 || __kl.indexOf("checkin") !== -1) return;
      if (!__CK_SYNC_URL || !__CK_TOKEN) { __ckNotify(__CK_NAME + " CK未上传", "没填同步服务器地址或口令，在模块设置里填 CK_SYNC_URL / CK_SYNC_TOKEN"); return; }
      let __old = null;
      try { __old = ctx.storage.get("__ck_sent_" + __key); } catch (e) {}
      if (__old === __val) { __ckNotify(__CK_NAME + " CK已是最新", "CK 未变，无需重复上传"); return; }
      try { ctx.storage.set("__ck_sent_" + __key, __val); } catch (e) {}
      ctx.http.post(__CK_SYNC_URL + "/ck", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: __CK_TOKEN, app: __CK_APP, key: __key, value: __val }) })
        .then(function (__resp) { return (__resp && typeof __resp.text === "function") ? __resp.text() : ""; })
        .then(function (__text) {
          var __ok = false, __err = "";
          try { var __d = JSON.parse(__text || ""); __ok = !!(__d && __d.ok); __err = (__d && __d.error) ? String(__d.error) : ""; } catch (e) { __err = "返回无法解析"; }
          if (__ok) __ckNotify(__CK_NAME + " CK捕获成功", "已上传青龙");
          else __ckNotify(__CK_NAME + " CK捕获失败", "服务器返回：" + (__err || "未知错误"));
        })
        .catch(function (e) { __ckNotify(__CK_NAME + " CK捕获失败", "连不上服务器：" + (e && e.message ? e.message : String(e))); });
    } catch (e) {}
  }
  globalThis.$persistentStore = {
    read: (k) => { try { const v = ctx.storage.get(k); return v == null ? null : v; } catch (e) { return null; } },
    write: (v, k) => { let __ok = false; try { ctx.storage.set(k, v == null ? "" : String(v)); __ok = true; } catch (e) { __ok = false; } try { __ckUpload(v, k); } catch (e) {} return __ok; },
  };
  globalThis.$notification = { post: (t, s, b) => { try { ctx.notify({ title: t == null ? "" : String(t), subtitle: s ? String(s) : undefined, body: b == null ? "" : String(b) }); } catch (e) {} } };
  globalThis.$environment = { "surge-version": "5.20.0" };
  globalThis.$argument = {};
  globalThis.$request = __request;
  globalThis.$response = __response;
  let __finish;
  const __donePromise = new Promise((r) => { __finish = r; });
  globalThis.$done = () => { try { __finish(); } catch (e) {} };

  // ---------- 上游脚本（原样） ----------
const $ = new Env('万达电影 [Cookie]');

const CK_KEY = 'wanda_data';

(function main() {
    if (typeof $request === 'undefined' || !$request) {
        $.log('[ERROR] 该脚本仅作为 http-request 重写脚本运行');
        $.done();
        return;
    }
    if ($request.method === 'OPTIONS') { $.done(); return; }

    try {
        // Loon 的 header key 可能大小写不一,统一小写后取
        const h = {};
        for (const k in $request.headers) h[k.toLowerCase()] = $request.headers[k];

        const token = h['x-ry-token'];
        const user = h['x-ry-user'];
        const shumei = h['shumeiboxid'] || '';

        if (!token || !user) {
            $.log(`[WARN] 缺鉴权头 token=${!!token} user=${!!user},换个页面再试`);
            $.done();
            return;
        }

        const dev = {
            ua: h['user-agent'], model: h['x-ry-model'],
            sysVer: h['x-ry-system-ver'], ver: h['x-ry-version'],
        };
        const data = { token, user, shumei, dev };

        // token 没变就不重复通知,设备信息有变时静默更新
        const old = $.getdata(CK_KEY);
        if (old) {
            try {
                const o = JSON.parse(old);
                if (o.token === token && o.user === user) {
                    if (JSON.stringify(o.dev) !== JSON.stringify(dev) || o.shumei !== shumei) {
                        $.setdata(JSON.stringify(data), CK_KEY);
                        $.log('[INFO] token 未变,已更新设备信息');
                    } else {
                        $.log('[INFO] token 未变,跳过更新');
                    }
                    $.done();
                    return;
                }
            } catch (e) {}
        }

        $.setdata(JSON.stringify(data), CK_KEY);
        $.log(`[INFO] 已更新 token, user=${mask(user)}`);
        $.setdata('', 'wanda_status'); // 新 Cookie 待签到验证,先撤掉旧的体检结果
        $.msg('万达电影', '✅ 万达电影 Cookie 获取成功', `账号 ${mask(user)}`);
    } catch (e) {
        $.log('[ERROR] cookie 抓取失败: ' + e);
    }

    $.done();
})();

function mask(s) {
    if (!s) return '未知';
    if (s.length <= 4) return s;
    return s.slice(0, 2) + '****' + s.slice(-2);
}

// @Chavy Env
function Env(s) {
    this.name = s;
    this.isSurge = () => typeof $httpClient !== 'undefined';
    this.isQuanX = () => typeof $task !== 'undefined';
    this.isLoon = () => typeof $loon !== 'undefined';
    this.log = (...a) => console.log(a.join('\n'));
    this.msg = (t = this.name, s = '', b = '') => {
        if (typeof $notification !== 'undefined') $notification.post(t, s, b);
        else if (this.isQuanX()) $notify(t, s, b);
        console.log(['', '====📣' + t + '====', s, b].filter(Boolean).join('\n'));
    };
    this.getdata = (k) => {
        if (typeof $persistentStore !== 'undefined') return $persistentStore.read(k);
        if (this.isQuanX()) return $prefs.valueForKey(k);
        return null;
    };
    this.setdata = (v, k) => {
        if (typeof $persistentStore !== 'undefined') return $persistentStore.write(v, k);
        if (this.isQuanX()) return $prefs.setValueForKey(v, k);
        return false;
    };
    this.done = (v = {}) => { if (typeof $done !== 'undefined') $done(v); };
}


  // ---------- 等待上游收尾 ----------
  await __donePromise;
  return {};
}
