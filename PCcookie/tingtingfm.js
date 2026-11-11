// tingtingfm · Cookie 抓取（Egern 移植版）
// 原作: MaYIHEI
// 上游来源: https://raw.githubusercontent.com/MaYIHEI/paperclip/refs/heads/main/app/tingtingfm/tingtingfm.js
// 上游更新日期: 2026-10-28
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
const $ = new Env("听听FM");

// 签到合集开启「统一通知」时不单独弹通知,结果由签到汇总统一发送
$.merge = typeof $argument === "object" && !!$argument && $argument.merge === true;
if ($.merge) $.msg = (...a) => console.log(a.filter((x) => typeof x === "string" && x).join("\n"));

// 补签入口:请求 http://1.1.1.1/checkin/tingtingfm 时现跑一次签到,跑完把本脚本的签到状态作为响应返回
const CHECKIN_RUN = typeof $request !== 'undefined' && /^http:\/\/1\.1\.1\.1\/checkin\//.test($request.url);
if (CHECKIN_RUN) { const end = $.done.bind($); $.done = () => end({ response: { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: $.getdata('tingtingfm_status') || '{}' } }); }

const SCRIPT_VERSION = "2026-10-28.r4"; // 改一次 +1,确认拉到最新版
$.log(`[INFO] 脚本版本 ${SCRIPT_VERSION}`);

const CK_KEY = 'tingtingfm_data';        // 存的是含 s_k 会话密钥的完整 User-Agent
const BASE   = 'https://xunting.vbegin.com.cn';
const DEBUG  = JSON.parse($.getdata('tingtingfm_debug') || 'false');

// ─── 入口 ────────────────────────────────────────────────────────────────────
if (typeof $request !== "undefined" && !CHECKIN_RUN) {
    getCookie();
    $.done();
} else {
    (async () => {
        if (JSON.parse($.getdata("tingtingfm_clear") || "false")) {
            $.setdata("", CK_KEY);
            $.setdata("false", "tingtingfm_clear");
            $.msg($.name, "", "✅ Cookie 已清除，请重新抓取");
            return $.done();
        }
        try {
            await main();
        } catch (e) {
            saveStatus('fail', String(e && e.message || e));
            $.msg($.name, '❌ 运行异常', String(e && e.message || e));
        } finally {
            $.done();
        }
    })();
}

// ─── 抓 Cookie ───────────────────────────────────────────────────────────────
// 触发条件: 打开听听FM APP →「我的」→「任务中心」，停留 1 秒等 /sns/app 请求发出
// 凭证就是请求 User-Agent 里的 s_k 会话密钥(无 cookie / 无鉴权头)，存完整 UA 回放
function getCookie() {
    const ua = $request.headers['user-agent'] || $request.headers['User-Agent'] || '';
    const m = ua.match(/s_k:([^;)]+)/);
    if (!m) {
        $.msg($.name, '⚠️ 未提取到会话密钥',
            '请确认已开启 MITM 并进「我的 → 任务中心」页面');
        return;
    }
    $.setdata(ua, CK_KEY);
    $.setdata('', 'tingtingfm_status'); // 新 Cookie 待签到验证,先撤掉旧的体检结果
    $.msg($.name, '✅ 听听FM Cookie 获取成功', `s_k: ${maskToken(m[1])}`);
}

// ─── 签到主逻辑 ──────────────────────────────────────────────────────────────
async function main() {
    const ua = $.getdata(CK_KEY);
    if (!ua) {
        saveStatus('none', '未抓取 Cookie');
        $.msg($.name, '🚫 缺少 Cookie',
            '请先开启重写规则，打开听听FM APP 进「我的 → 任务中心」页面');
        return;
    }

    // 1. 用 s_k(在 UA 里)换取本次会话 token —— token 每次现生成、不可长期缓存
    const token = await login(ua);
    if (!token) {
        saveStatus(token === false ? 'fail' : 'cookie', token === false ? '网络错误' : '会话密钥已过期');
        $.msg($.name, '🚫 会话密钥失效',
            's_k 已过期，请重新打开听听FM「任务中心」重抓 Cookie');
        return;
    }
    if (DEBUG) $.log(`[login] token=${maskToken(token)}`);

    // 2. 执行每日签到(task=2)。task=1=听15分钟需真实收听、task=3=分享广播，均不在此处理
    const r = await sign(token, ua, 2);
    if (DEBUG) $.log(`[sign] resp=${JSON.stringify(r).slice(0, 400)}`);

    if (!r || r.status !== 200 || r.error) {
        saveStatus('fail', (r && r.error) ? String(r.error) : '无响应');
        $.msg($.name, '❌ 签到失败', (r && r.error) ? String(r.error) : '无响应');
        return;
    }

    const data = r.data || {};
    const log  = data.logs;             // 本次新签到产生流水(含 grow/coin)；今日已签为 null
    const point = await getPoint(token, ua);
    const pointStr = point != null ? ` · 金币 ${point}` : '';

    saveStatus('ok', log ? `签到成功 +${log.grow || 0} 成长值` : '今日已签到', point != null ? `金币 ${point}` : undefined);
    if (log) {
        $.msg($.name, '✅ 签到成功',
            `+${log.grow || 0} 成长值 · +${log.coin || 0} 金币${pointStr}`);
    } else {
        // logs 为 null 且无 error = 今日已签(服务端幂等，不重复发放)
        $.msg($.name, '✨ 今日已签到', `成长值/金币不再重复发放${pointStr}`);
    }
}

// ─── 接口封装 ────────────────────────────────────────────────────────────────

// POST /sns/app —— 凭 UA 里的 s_k 换取本次会话 token
function login(ua) {
    return new Promise((resolve) => {
        $.post({ url: `${BASE}/sns/app`, headers: buildHeaders(ua), body: '' },
            (err, _resp, body) => {
                if (err) { $.log(`[login] 错误: ${JSON.stringify(err)}`); return resolve(false); } // false = 网络错误,区别于密钥失效
                try {
                    const j = JSON.parse(body);
                    resolve(j && j.status === 200 ? j.data : null);
                } catch (e) {
                    $.log(`[login] 响应解析失败: ${String(body).slice(0, 200)}`);
                    resolve(null);
                }
            });
    });
}

// POST /api/sns/grow/daily/tasks?token=X  body: task=N
function sign(token, ua, task) {
    return new Promise((resolve) => {
        const headers = buildHeaders(ua);
        headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        $.post({
            url: `${BASE}/api/sns/grow/daily/tasks?token=${encodeURIComponent(token)}`,
            headers,
            body: `task=${task}`,
        }, (err, _resp, body) => {
            if (err) { $.log(`[sign] 错误: ${JSON.stringify(err)}`); return resolve(null); }
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                $.log(`[sign] 响应解析失败: ${String(body).slice(0, 200)}`);
                resolve(null);
            }
        });
    });
}

// GET /api/sns/app/point?token=X —— 当前金币数(仅用于通知展示，失败不影响签到)
function getPoint(token, ua) {
    return new Promise((resolve) => {
        $.get({
            url: `${BASE}/api/sns/app/point?token=${encodeURIComponent(token)}&_=${Date.now()}`,
            headers: buildHeaders(ua),
        }, (err, _resp, body) => {
            if (err) return resolve(null);
            try {
                const j = JSON.parse(body);
                resolve(j && j.status === 200 ? j.data : null);
            } catch (e) { resolve(null); }
        });
    });
}

// 记录本次结果,供「签到汇总」:ok 正常 / cookie 需重新抓取 / fail 其他失败 / none 未使用
function saveStatus(s, msg, asset) {
    msg = String(msg).slice(0, 100);
    // 服务器明确提示登录过期的失败,按需要重新抓取处理
    if (s === 'fail' && /过期|重新登录|未登录|请登录|登录失效|登录已失效|token\s*(失效|过期|无效)|not\s*login/i.test(msg)) s = 'cookie';
    // 同一天已有带奖励的成功记录时,再次运行得到的「今日已签」不覆盖它的奖励文字,只合并本次的资产等信息
    let keep = null;
    if (s === 'ok' && /^今日已/.test(msg)) {
        const day = (t) => new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
        let old = null;
        try { old = JSON.parse($.getdata('tingtingfm_status') || 'null'); } catch (e) {}
        if (old && old.s === 'ok' && !/^今日已/.test(old.msg) && day(old.t) === day(Date.now())) keep = old;
    }
    checkinReport('tingtingfm_status', keep ? keepReward(keep, { s, msg, asset }) : { s, msg, asset }, { name: '听听FM', author: 'MaYIHEI', run: 'http://1.1.1.1/checkin/tingtingfm', open: 'https://apps.apple.com/app/id885422779' });
}

function buildHeaders(ua) {
    return {
        'accept':          'application/json, text/javascript, */*; q=0.01',
        'accept-language': 'zh-CN,zh-Hans;q=0.9',
        'origin':          'https://tingtingfm.vbegin.com.cn',
        'referer':         'https://tingtingfm.vbegin.com.cn/',
        'user-agent':      ua,
    };
}

function maskToken(s) {
    if (!s || s.length < 12) return '***';
    return s.slice(0, 6) + '...' + s.slice(-4);
}

// 保留当天带奖励的旧记录(状态、奖励文字、时间),合并本次拿到的资产、过期时间等;本次没有的沿用旧值
function keepReward(old, rec) {
    const out = { s: old.s, msg: old.msg, t: old.t, asset: old.asset, exp: old.exp };
    for (const k in rec) if (rec[k] !== undefined && k !== 's' && k !== 'msg') out[k] = rec[k];
    return out;
}

// 签到状态协议 v1:写本次结果,并把自己登记进公共索引 checkin_registry(Loon/Surge/QX/Stash 通用,不依赖 Env)
function checkinReport(key, rec, info) {
    const read = (k) => (typeof $prefs !== 'undefined' ? $prefs.valueForKey(k) : $persistentStore.read(k));
    const write = (v, k) => (typeof $prefs !== 'undefined' ? $prefs.setValueForKey(v, k) : $persistentStore.write(v, k));
    const registry = () => { try { return JSON.parse(read('checkin_registry') || '{}') || {}; } catch (e) { return {}; } };
    write(JSON.stringify(Object.assign({ v: 1, t: Date.now(), name: info.name, author: info.author }, rec)), key);
    const reg = registry();
    if (JSON.stringify(reg[key]) === JSON.stringify(info)) return;
    reg[key] = info;
    write(JSON.stringify(reg), 'checkin_registry');
    if (!registry()[key]) console.log(`[checkin] ${key} 登记没写上,下次运行再补`);
}

// ─── Env（轻量版，兼容 Loon / Surge / QX / Stash）────────────────────────────
function Env(s) {
    this.name = s;
    this.isSurge = () => typeof $httpClient !== 'undefined';
    this.isQuanX = () => typeof $task !== 'undefined';
    this.isLoon  = () => typeof $loon !== 'undefined';
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
    this.get  = (req, cb) => this.send(req, 'GET',  cb);
    this.post = (req, cb) => this.send(req, 'POST', cb);
    this.send = (req, method, cb) => {
        if (this.isSurge() || this.isLoon()) {
            const fn = method === 'POST' ? $httpClient.post : $httpClient.get;
            fn(req, (err, resp, data) => {
                if (resp) { resp.body = data; resp.statusCode = resp.status || resp.statusCode; }
                cb(err, resp, data);
            });
        } else if (this.isQuanX()) {
            req.method = method;
            $task.fetch(req).then(
                (r) => { r.status = r.statusCode; cb(null, r, r.body); },
                (e) => cb(e.error || e, null, null)
            );
        }
    };
    this.done = (v = {}) => { if (typeof $done !== 'undefined') $done(v); };
}


  // ---------- 等待上游收尾 ----------
  await __donePromise;
  return {};
}
