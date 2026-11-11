// mihoyo · Cookie 抓取（Egern 移植版）
// 原作: MaYIHEI
// 上游来源: https://raw.githubusercontent.com/MaYIHEI/paperclip/refs/heads/main/app/mihoyo/mihoyo.cookie.js
// 上游更新日期: 2026-07-27
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
const $ = new Env("米游社 [Cookie]");

const KEY_STOKEN_COOKIE   = 'mhy_stoken_cookie';     // 仅作记录用,主脚本不再依赖
const KEY_GAME_ROLES      = 'mhy_game_roles';        // 角色列表 (从 stoken 接口响应抠出来)
const KEY_WEB_COOKIE      = 'mhy_web_cookie';
const KEY_WEB_HEADERS     = 'mhy_web_headers';

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

    const url = $request.url;
    const headers = $request.headers || {};
    const cookie = headers.Cookie || headers.cookie || '';

    // 抓取 1: 从 getUserGameRolesByStoken 响应里抠出角色列表
    // 注意: 这里需要 http-response 模式 (requires-body=true),$response 可用
    if (/api-takumi\.miyoushe\.com\/binding\/api\/getUserGameRolesByStoken/.test(url)) {
        try {
            if (!$response || !$response.body) {
                $.log('[WARN] stoken 接口没有响应体,可能 Loon 没开 requires-body');
                $.done(); return;
            }
            const data = JSON.parse($response.body);
            if (data.retcode !== 0 || !data.data || !Array.isArray(data.data.list)) {
                $.log(`[WARN] stoken 接口响应不正常: retcode=${data.retcode}`);
                $.done(); return;
            }
            const roles = data.data.list.map(x => ({
                game_biz: x.game_biz,
                region: x.region,
                game_uid: x.game_uid,
                nickname: x.nickname,
                region_name: x.region_name,
            }));
            $.setdata(JSON.stringify(roles), KEY_GAME_ROLES);
            $.setdata(cookie, KEY_STOKEN_COOKIE);  // 仍存一份,供调试参考
            $.log(`[INFO] 角色列表已存: ${roles.length} 个角色`);
            roles.forEach(r => $.log(`  ${r.game_biz} ${r.nickname} (${r.game_uid})`));
            notify();
        } catch (e) { $.log('[ERROR] stoken 响应解析失败: ' + e); }
        $.done(); return;
    }

    // 抓取 2: web 签到 cookie + headers
    // 米哈游已不再把 cookie_token 放进「请求 Cookie」,改为在 luna 接口的「响应 Set-Cookie」里下发,
    // 所以这里从 $response 的 Set-Cookie 抠 cookie_token_v2 + account_mid_v2 + account_id_v2 拼成 web cookie。
    if (/api-takumi\.mihoyo\.com\/event\/luna\/(?:[a-z0-9]+\/)?(info|home|sign)(?:[/?]|$)/.test(url)) {
        try {
            const setCookie = readSetCookie($response && $response.headers);
            const want = ['cookie_token_v2', 'account_mid_v2', 'account_id_v2'];
            const parts = [];
            for (const name of want) {
                const m = setCookie.match(new RegExp(name + '=([^;]+)'));
                if (m) parts.push(name + '=' + m[1].trim());
            }
            if (parts.length < want.length) {
                $.log(`[WARN] Set-Cookie 缺字段,只拿到 ${parts.length}/${want.length},跳过(进游戏签到页等几秒再试)`);
                $.done(); return;
            }
            $.setdata(parts.join('; '), KEY_WEB_COOKIE);
            $.setdata(JSON.stringify(headers), KEY_WEB_HEADERS);  // header 模板(DS / x-rpc-* / UA)仍从请求头取
            $.setdata('', 'mihoyo_status'); // 新 Cookie 待签到验证,先撤掉旧的体检结果
            $.log(`[INFO] web cookie 已存: ${parts.length}字段 headers ${Object.keys(headers).length}个`);
            notify();
        } catch (e) { $.log('[ERROR] web cookie: ' + e); }
        $.done(); return;
    }

    $.done();
})();

// Set-Cookie 在不同核心里 header 名大小写不定、值可能是字符串或数组,统一拼成一段字符串
function readSetCookie(respHeaders) {
    if (!respHeaders) return '';
    let out = '';
    for (const k in respHeaders) {
        if (k.toLowerCase() === 'set-cookie') {
            const v = respHeaders[k];
            out += (Array.isArray(v) ? v.join('; ') : v) + '; ';
        }
    }
    return out;
}

function notify() {
    const has1 = !!$.getdata(KEY_GAME_ROLES);
    const has2 = !!$.getdata(KEY_WEB_COOKIE);
    const status = `${has1 ? '✅' : '⏳'}角色 ${has2 ? '✅' : '⏳'}签到`;

    let next = '';
    if (!has1) next = '\n👉 米游社 APP → 我的';
    else if (!has2) next = '\n👉 进任一游戏签到页面手动签到';
    else next = '\n✨ 全部就绪,可关闭本脚本';

    $.msg('米游社 Cookie', status, next);
}


// @Chavy minimal Env
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
