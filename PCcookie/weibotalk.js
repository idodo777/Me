// weibotalk · Cookie 抓取（Egern 移植版）
// 原作: MaYIHEI
// 上游来源: https://raw.githubusercontent.com/MaYIHEI/paperclip/refs/heads/main/app/weibotalk/weibotalk.cookie.js
// 上游更新日期: 2026-05-09
// 移植说明: 上游脚本逻辑原样保留，仅在外层把 Surge 环境 API 桥接到 Egern ctx。
export default async function (ctx) {
  if (!(ctx.env && ctx.env.WEIBOTALK === "true")) return {}; // 本应用开关：在模块设置页打开后才抓取

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
const $ = new Env("微博超话 [Cookie]");

const KEY_LIST_URL = 'evil_tokenurl';
const KEY_LIST_HEADERS = 'evil_tokenheaders';
const KEY_LIST_BODY = 'evil_tokenbody';
const KEY_CHECKIN_URL = 'evil_tokencheckinurl';
const KEY_CHECKIN_HEADERS = 'evil_tokencheckinheaders';

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

    // 抓取 1: 关注超话列表
    if (/\/2\/statuses\/container_timeline_topicsub/.test(url)) {
        try {
            const headers = $request.headers;
            let body = $request.body || '';
            if (!body || body.length < 10) {
                body = 'filterGroupStyle=1&flowId=232478_-_mine_topic&flowVersion=0.0.1&lfid=profile_me&luicode=10000011&mix_media_enable=1&moduleID=pagecard&orifid=profile_me&oriuicode=10000011&pageDataType=flow&sg_tab_config=2&source_code=10000011_profile_me&taskType=refresh&uicode=10001387';
                $.log('[INFO] 未抓到 body,使用兜底默认值');
            }
            $.setdata(url, KEY_LIST_URL);
            $.setdata(JSON.stringify(headers), KEY_LIST_HEADERS);
            $.setdata(body, KEY_LIST_BODY);
            $.setdata('', 'weibotalk_status'); // 新 Cookie 待签到验证,先撤掉旧的体检结果
            $.log(`[INFO] 列表 cookie: url=${url.length}字符 headers=${Object.keys(headers).length}个 body=${body.length}字符`);

            const checkinExists = !!$.getdata(KEY_CHECKIN_URL);
            const subtitle = '✅ 已获取关注列表 Cookie';
            const body_msg = checkinExists
                ? '✨ 列表 + 签到 cookie 都已就绪,可关闭本脚本'
                : '🔍 接下来请进一个超话手动签到一次,以获取签到 cookie';
            $.msg('微博超话', subtitle, body_msg);
        } catch (e) {
            $.log('[ERROR] 列表 cookie 抓取失败: ' + e);
        }
        $.done();
        return;
    }

    // 抓取 2: 签到接口 (放宽: 只要 page/button 路径就尝试存,签到/已签都能命中)
    // 这样 active_checkin / 已签状态查询 等任何 button 接口都能用
    if (/\/2\/page\/button/.test(url)) {
        try {
            const headers = $request.headers;
            $.setdata(url, KEY_CHECKIN_URL);
            $.setdata(JSON.stringify(headers), KEY_CHECKIN_HEADERS);
            $.setdata('', 'weibotalk_status');
            $.log(`[INFO] 签到 cookie: url=${url.length}字符 headers=${Object.keys(headers).length}个`);
            $.log(`[INFO] 签到 url 含 active_checkin: ${/active_checkin/.test(url)}`);

            const listExists = !!$.getdata(KEY_LIST_URL);
            const subtitle = '🎉 已获取签到 Cookie';
            const body_msg = listExists
                ? '✨ 列表 + 签到 cookie 都已就绪,请关闭本脚本'
                : '⚠️ 还需要进关注列表页抓取列表 cookie';
            $.msg('微博超话', subtitle, body_msg);
        } catch (e) {
            $.log('[ERROR] 签到 cookie 抓取失败: ' + e);
        }
        $.done();
        return;
    }

    $.done();
})();


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
