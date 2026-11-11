// newmixc · Cookie 抓取（Egern 移植版）
// 原作: MaYIHEI
// 上游来源: https://raw.githubusercontent.com/MaYIHEI/paperclip/refs/heads/main/app/newmixc/newmixc.cookie.js
// 上游更新日期: 2026-05-23
// 移植说明: 上游脚本逻辑原样保留，仅在外层把 Surge 环境 API 桥接到 Egern ctx。
export default async function (ctx) {

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
  globalThis.$persistentStore = {
    read: (k) => { try { const v = ctx.storage.get(k); return v == null ? null : v; } catch (e) { return null; } },
    write: (v, k) => { try { ctx.storage.set(k, v == null ? "" : String(v)); return true; } catch (e) { return false; } },
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
const $ = new Env("一点万象 [Cookie]");

const CK_KEY = 'newmixc_data';

(function main() {
    if (!$request) {
        $.log('[ERROR] 该脚本仅作为 http-request 重写脚本运行');
        $.done();
        return;
    }
    if ($request.method === 'OPTIONS') {
        $.done();
        return;
    }

    try {
        const url = $request.url;
        // 从 URL query 抠所有需要的字段
        const need = ['token', 'mallNo', 'imei', 'deviceParams', 'appVersion', 'osVersion'];
        const got = {};
        for (const k of need) {
            const m = url.match(new RegExp('[?&]' + k + '=([^&]+)'));
            if (m) got[k] = decodeURIComponent(m[1]);
        }

        const missing = need.filter(k => !got[k]);
        if (missing.length) {
            $.log(`[WARN] 缺字段: ${missing.join(',')}`);
            $.done();
            return;
        }

        // 解 deviceParams 拿手机号(显示用)
        let phone = '';
        try {
            const dpJson = JSON.parse(decodeBase64(got.deviceParams));
            phone = dpJson.phone || '';
        } catch (e) {
            $.log('[WARN] deviceParams 解析失败: ' + e);
        }

        const data = {
            token: got.token,
            mallNo: got.mallNo,
            imei: got.imei,
            deviceParams: got.deviceParams,
            appVersion: got.appVersion,
            osVersion: got.osVersion,
            phone: phone,
        };

        const old = $.getdata(CK_KEY) || '';
        if (old) {
            try {
                const oldObj = JSON.parse(old);
                if (oldObj.token === data.token && oldObj.mallNo === data.mallNo) {
                    $.log('[INFO] Token 未变,跳过更新');
                    $.done();
                    return;
                }
            } catch (e) {}
        }

        $.setdata(JSON.stringify(data), CK_KEY);
        $.log(`[INFO] 已更新 token, phone=${maskPhone(phone)}, mallNo=${data.mallNo}`);
        $.setdata('', 'newmixc_status'); // 新 Cookie 待签到验证,先撤掉旧的体检结果
        $.msg('一点万象', '✅ 一点万象 Cookie 获取成功', `账号 ${maskPhone(phone)} · 商场 ${data.mallNo}`);
    } catch (e) {
        $.log('[ERROR] cookie 抓取失败: ' + e);
    }

    $.done();
})();

function maskPhone(p) {
    if (!p || p.length !== 11) return p || '未知';
    return p.slice(0, 3) + '****' + p.slice(7);
}

function decodeBase64(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(s, 'base64').toString('utf-8');
    }
    // 浏览器/QX 环境 atob
    return decodeURIComponent(escape(atob(s)));
}

function Env(s) {
    this.name = s;
    this.isSurge = () => typeof $httpClient !== 'undefined';
    this.isQuanX = () => typeof $task !== 'undefined';
    this.isLoon = () => typeof $loon !== 'undefined';
    this.log = (...a) => console.log(a.join('\n'));
    this.msg = (t = this.name, s = '', b = '') => {
        if (this.isSurge() || this.isLoon()) $notification.post(t, s, b);
        else if (this.isQuanX()) $notify(t, s, b);
        console.log(['', '====📣' + t + '====', s, b].filter(Boolean).join('\n'));
    };
    this.getdata = (k) => {
        if (this.isSurge() || this.isLoon()) return $persistentStore.read(k);
        if (this.isQuanX()) return $prefs.valueForKey(k);
        return null;
    };
    this.setdata = (v, k) => {
        if (this.isSurge() || this.isLoon()) return $persistentStore.write(v, k);
        if (this.isQuanX()) return $prefs.setValueForKey(v, k);
        return false;
    };
    this.done = (v = {}) => { if (typeof $done !== 'undefined') $done(v); };
}


  // ---------- 等待上游收尾 ----------
  await __donePromise;
  return {};
}
