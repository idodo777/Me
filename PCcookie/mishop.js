// mishop · Cookie 抓取（Egern 移植版）
// 原作: MaYIHEI
// 上游来源: https://raw.githubusercontent.com/MaYIHEI/paperclip/refs/heads/main/app/mishop/mishop.cookie.js
// 上游更新日期: 2026-05-27
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
const $ = new Env('小米商城 [Cookie]');

const CK_KEY = 'mishop_data';

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
        const headers = lowerHeaders($request.headers);

        // 小米商城 APP 用 HTTP/2 多个 cookie 头分别发送:
        //   cookie: serviceToken=...
        //   cookie: userId=...
        //   cookie: xmUuid=...
        // Loon/QX 合并方式不固定(可能是数组/换行/逗号/分号),统一规范成 "k1=v1; k2=v2; k3=v3"
        const cookie = normalizeCookie(headers['cookie']);
        if (!cookie || !/serviceToken=/.test(cookie)) {
            $.log('[WARN] cookie 里没有 serviceToken,跳过');
            $.done();
            return;
        }

        const userId = pickCookie(cookie, 'userId') || '';
        const ua = headers['user-agent'] || '';
        const dId = headers['d-id'] || '';
        const dModel = headers['d-model'] || '';

        const data = {
            cookie: cookie,
            userId: userId,
            ua: ua,
            dId: dId,
            dModel: dModel,
        };

        const old = $.getdata(CK_KEY) || '';
        if (old) {
            try {
                const oldObj = JSON.parse(old);
                if (oldObj.cookie === data.cookie) {
                    $.log('[INFO] Cookie 未变,跳过更新');
                    $.done();
                    return;
                }
            } catch (e) {}
        }

        const ok = $.setdata(JSON.stringify(data), CK_KEY);
        // 写后读回校验 (huisheng 经验: setdata 在重写环境可能静默失败)
        const verify = ($.getdata(CK_KEY) || '').length;

        if (verify > 0) {
            $.log(`[INFO] Cookie 已更新, userId=${userId}, cookie ${cookie.length}字符, 读回 ${verify}字符`);
            $.setdata('', 'mishop_status'); // 新 Cookie 待签到验证,先撤掉旧的体检结果
            $.msg('小米商城', '✅ 小米商城 Cookie 获取成功', `账号 ${userId} · 请关闭本脚本`);
        } else {
            $.log(`[ERROR] setdata 写入失败 (ok=${ok} verify=${verify})`);
            $.msg('小米商城', '⚠️ Cookie 写入失败', '存储读回为空,检查代理工具持久化权限');
        }
    } catch (e) {
        $.log('[ERROR] cookie 抓取失败: ' + e);
    }

    $.done();
})();

function pickCookie(cookie, key) {
    const m = cookie.match(new RegExp('(?:^|;\\s*)' + key + '=([^;]+)'));
    return m ? m[1] : '';
}

// 把 Loon/QX 拿到的 cookie 值统一规范成 "k1=v1; k2=v2; ..." 形式
// 输入可能是:
//   - string("a=1; b=2")                             分号合并
//   - string("a=1\ncookie: b=2\ncookie: c=3")        Loon HTTP/2 多头换行合并(残留 "cookie:" 前缀)
//   - string("a=1\nb=2")                             换行合并无前缀
//   - Array(["a=1","b=2","c=3"])                     数组
function normalizeCookie(raw) {
    if (!raw) return '';
    let parts = [];
    if (Array.isArray(raw)) {
        parts = raw;
    } else {
        parts = String(raw).split(/\r?\n/);
    }
    const flat = [];
    for (const p of parts) {
        let s = String(p).trim();
        if (!s) continue;
        // 清掉 Loon 合并多 header 时可能残留的 "cookie:" / "Cookie:" 前缀
        s = s.replace(/^cookie\s*:\s*/i, '').trim();
        if (!s) continue;
        flat.push(s);
    }
    return flat.join('; ');
}

function lowerHeaders(h) {
    const out = {};
    Object.keys(h || {}).forEach((k) => { out[k.toLowerCase()] = h[k]; });
    return out;
}

function Env(s) {
    this.name = s;
    // 注意:Loon http-request 重写脚本里 $httpClient / $loon 都可能 undefined,
    // 用 $persistentStore 判存储能力更稳。huisheng 第一版栽过这个坑。
    this.hasStore = () => typeof $persistentStore !== 'undefined';
    this.isQuanX = () => typeof $prefs !== 'undefined';
    this.log = (...a) => console.log(a.join('\n'));
    this.msg = (t = this.name, s = '', b = '') => {
        if (typeof $notification !== 'undefined') $notification.post(t, s, b);
        else if (typeof $notify !== 'undefined') $notify(t, s, b);
        console.log(['', '====📣' + t + '====', s, b].filter(Boolean).join('\n'));
    };
    this.getdata = (k) => {
        if (this.hasStore()) return $persistentStore.read(k);
        if (this.isQuanX()) return $prefs.valueForKey(k);
        return null;
    };
    this.setdata = (v, k) => {
        if (this.hasStore()) return $persistentStore.write(v, k);
        if (this.isQuanX()) return $prefs.setValueForKey(v, k);
        return false;
    };
    this.done = (v = {}) => { if (typeof $done !== 'undefined') $done(v); };
}


  // ---------- 等待上游收尾 ----------
  await __donePromise;
  return {};
}
