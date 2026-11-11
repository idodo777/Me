// youpin · Cookie 抓取（Egern 移植版）
// 原作: MaYIHEI
// 上游来源: https://raw.githubusercontent.com/MaYIHEI/paperclip/refs/heads/main/app/youpin/youpin.js
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
const $ = new Env("小米有品");

// 签到合集开启「统一通知」时不单独弹通知,结果由签到汇总统一发送
$.merge = typeof $argument === "object" && !!$argument && $argument.merge === true;
if ($.merge) $.msg = (...a) => console.log(a.filter((x) => typeof x === "string" && x).join("\n"));

// 补签入口:请求 http://1.1.1.1/checkin/youpin 时现跑一次签到,跑完把本脚本的签到状态作为响应返回
const CHECKIN_RUN = typeof $request !== 'undefined' && /^http:\/\/1\.1\.1\.1\/checkin\//.test($request.url);
if (CHECKIN_RUN) { const end = $.done.bind($); $.done = () => end({ response: { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: $.getdata('youpin_status') || '{}' } }); }

const SCRIPT_VERSION = "2026-10-28.r3"; // 改一次 +1,确认拉到最新版
$.log(`[INFO] 脚本版本 ${SCRIPT_VERSION}`);

const CK_KEY  = 'youpin_data';
const BASE    = 'https://m.xiaomiyoupin.com';
// 每日签到活动 ID（channelId，固定值，Xiaomi 更新活动后可能变）
const ACT_ID  = '686b76a6ac546f0001b930c5';

// ─── 入口 ────────────────────────────────────────────────────────────────────
if (typeof $request !== "undefined" && !CHECKIN_RUN) {
    getCookie();
    $.done();
} else {
    (async () => {
        if (JSON.parse($.getdata("youpin_clear") || "false")) {
            $.setdata("", CK_KEY);
            $.setdata("false", "youpin_clear");
            $.msg($.name, "", "✅ Cookie 已清除，请重新抓取");
            return $.done();
        }
        try {
            await main();
        } catch (e) {
            saveStatus('fail', String(e));
            $.msg($.name, '❌ 运行异常', String(e));
        } finally {
            $.done();
        }
    })();
}

// ─── 抓 Cookie ───────────────────────────────────────────────────────────────
// 触发条件: 打开有品 APP → 「我的」→「签到有礼」，停留 1 秒等 getActInfo 请求发出
function getCookie() {
    // Loon 在 HTTP/2 多 cookie 头时会将多个 "cookie: xxx" 合并成换行分隔字符串
    // 需要先 normalize，去掉每行残留的 "cookie: " 前缀后再按分号解析
    const raw = normalizeCookie(
        $request.headers['cookie'] || $request.headers['Cookie'] || ''
    );

    const serviceToken  = parseCookieField(raw, 'serviceToken');
    const youpinSession = parseCookieField(raw, 'youpin_sessionid');
    // youpindistinct_id: 神策数据生成的设备 distinct_id，随 cookie 一起传
    const distinctId    = parseCookieField(raw, 'youpindistinct_id');

    if (!serviceToken) {
        $.msg($.name, '⚠️ 未提取到 serviceToken',
            '请确认已开启 MITM 并进「我的 → 签到有礼」页面');
        return;
    }

    const ua = $request.headers['user-agent'] || $request.headers['User-Agent'] || '';

    const ck = { serviceToken, youpinSession, distinctId, userAgent: ua };
    $.setdata(JSON.stringify(ck), CK_KEY);
    $.setdata('', 'youpin_status'); // 新 Cookie 待签到验证,先撤掉旧的体检结果

    $.msg(
        $.name,
        '✅ 小米有品 Cookie 获取成功',
        `serviceToken: ${maskToken(serviceToken)}\n` +
        `session: ${maskToken(youpinSession || '-')}`
    );
}

// ─── 签到主逻辑 ──────────────────────────────────────────────────────────────
async function main() {
    const raw = $.getdata(CK_KEY);
    if (!raw) {
        saveStatus('none', '未抓取 Cookie');
        $.msg($.name, '🚫 缺少 Cookie',
            '请先开启重写规则，打开有品 APP 进「我的 → 签到有礼」页面');
        return;
    }

    let ck;
    try {
        ck = JSON.parse(raw);
    } catch (e) {
        saveStatus('cookie', 'Cookie 解析失败');
        $.msg($.name, '🚫 Cookie 解析失败', '请清空后重新触发抓取');
        return;
    }

    if (!ck.serviceToken) {
        saveStatus('cookie', 'serviceToken 为空');
        $.msg($.name, '🚫 serviceToken 为空', '请重新进「签到有礼」页面');
        return;
    }

    const headers = buildHeaders(ck);

    // 1. 查询签到状态
    let actData;
    try {
        const r = await post(`${BASE}/mtop/act/redPacketSign/getActInfo`, headers,
            [{}, { actId: ACT_ID }]);
        if (!r || r.code !== 0) {
            saveStatus('fail', `状态查询失败 code=${r && r.code} ${r && (r.msg || r.message)}`);
            $.msg($.name, '❌ 状态查询失败',
                `code=${r && r.code} msg=${r && (r.msg || r.message)}`);
            return;
        }
        actData = r.data;
    } catch (e) {
        saveStatus('fail', `状态请求异常 ${e}`);
        $.msg($.name, '❌ 状态请求异常', String(e));
        return;
    }

    const signInfo = actData && actData.signUserInfo;
    const alreadySigned = signInfo && signInfo.sign === true;

    if (alreadySigned) {
        saveStatus('ok', '今日已签到');
        $.msg($.name, '✨ 今日已签到', `连签第 ${(signInfo.dayIndex || 0) + 1} 天`);
        return;
    }

    // 2. 执行签到（接口已通过抓包验证: 2026-05-27）
    let signResult;
    try {
        signResult = await post(`${BASE}/mtop/act/redPacketSign/clickSign`, headers,
            [{}, { actId: ACT_ID }]);
    } catch (e) {
        saveStatus('fail', `签到请求异常 ${e}`);
        $.msg($.name, '❌ 签到请求异常', String(e));
        return;
    }

    if (!signResult || signResult.code !== 0) {
        const errMsg = (signResult && (signResult.msg || signResult.message)) || JSON.stringify(signResult).slice(0, 200);
        saveStatus('fail', errMsg);
        $.msg($.name, '❌ 签到失败', errMsg);
        return;
    }

    // 解析奖励（红包金额随机，响应示例: {"amount":"0.15","msg":"签到成功！"}）
    const data = signResult.data || {};
    const amount = data.amount || '?';
    const tip    = data.msg || '';

    let body = `💰 获得红包 ¥${amount}`;
    if (tip && tip !== '签到成功！') body += `\n${tip}`;

    saveStatus('ok', `签到成功 红包 ¥${amount}`);
    $.msg($.name, '✅ 签到成功', body);
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * Loon HTTP/2 多 cookie 头 normalize
 * 多个独立 cookie: 头被合并后形如:
 *   "mijiasn=YPQD_YPMRQD\ncookie: mjclient=YouPin\ncookie: serviceToken=..."
 * 需要去掉每行的 "cookie: " 前缀，再按 "; " 拼回标准格式
 */
function normalizeCookie(raw) {
    if (!raw) return '';
    const parts = raw.split('\n').flatMap(line =>
        line.replace(/^cookie:\s*/i, '').split(';')
    );
    return parts.map(s => s.trim()).filter(Boolean).join('; ');
}

// 记录本次结果,供「签到汇总」:ok 正常 / cookie 需重新抓取 / fail 其他失败 / none 未使用
function saveStatus(s, msg) {
    msg = String(msg).slice(0, 100);
    // 服务器明确提示登录过期的失败,按需要重新抓取处理
    if (s === 'fail' && /过期|重新登录|未登录|请登录|登录失效|登录已失效|token\s*(失效|过期|无效)|not\s*login/i.test(msg)) s = 'cookie';
    // 同一天已有带奖励的成功记录时,再次运行得到的「今日已签」不覆盖它的奖励文字,只合并本次的资产等信息
    let keep = null;
    if (s === 'ok' && /^今日已/.test(msg)) {
        const day = (t) => new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
        let old = null;
        try { old = JSON.parse($.getdata('youpin_status') || 'null'); } catch (e) {}
        if (old && old.s === 'ok' && !/^今日已/.test(old.msg) && day(old.t) === day(Date.now())) keep = old;
    }
    checkinReport('youpin_status', keep ? keepReward(keep, { s, msg }) : { s, msg }, { name: '小米有品', author: 'MaYIHEI', run: 'http://1.1.1.1/checkin/youpin', open: 'https://apps.apple.com/app/id1212182562' });
}

function parseCookieField(cookieStr, field) {
    if (!cookieStr) return undefined;
    const seg = cookieStr.split(';').find(s => s.trim().startsWith(field + '='));
    return seg ? seg.trim().slice(field.length + 1) : undefined;
}

/**
 * 构建 m.xiaomiyoupin.com 的请求头
 * 关键: sec-fetch-site=same-origin + origin + referer 缺一会被后端识别为非浏览器调用
 */
function buildHeaders(ck) {
    const cookieParts = [
        // mijiasn / mjclient 是活动页面固定注入的值，不随用户变化
        'mijiasn=YPQD_YPMRQD',
        'mjclient=YouPin',
        `serviceToken=${ck.serviceToken}`,
    ];
    if (ck.youpinSession) cookieParts.push(`youpin_sessionid=${ck.youpinSession}`);
    if (ck.distinctId)    cookieParts.push(`youpindistinct_id=${ck.distinctId}`);

    return {
        'content-type':    'application/json',
        'accept':          '*/*',
        'accept-language': 'zh-CN,zh-Hans;q=0.9',
        'accept-encoding': 'gzip, deflate, br',
        'origin':          'https://m.xiaomiyoupin.com',
        'referer':         `https://m.xiaomiyoupin.com/hd/checkInsignIn/index.html?hideNavBar=true&channelId=${ACT_ID}&source=YPQD_YPMRQD`,
        'sec-fetch-site':  'same-origin',
        'sec-fetch-mode':  'cors',
        'sec-fetch-dest':  'empty',
        'priority':        'u=3, i',
        'user-agent':      ck.userAgent ||
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) ' +
            'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 ' +
            'MIOTStore/20191212 (YouPin;5.32.0;;;;I;;;)',
        'cookie': cookieParts.join('; '),
    };
}

function post(url, headers, body) {
    return new Promise((resolve, reject) => {
        $.post({ url, headers, body: JSON.stringify(body), timeout: 10000 },
            (err, _resp, data) => {
                if (err) { reject(err); return; }
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    debug(`JSON 解析失败，原始响应: ${String(data).slice(0, 300)}`);
                    reject(new Error('JSON parse error'));
                }
            });
    });
}

function maskToken(s) {
    if (!s || s.length < 12) return '***';
    return s.slice(0, 6) + '...' + s.slice(-4);
}

// ─── Env（轻量版，兼容 Loon / Surge / QX / Stash）────────────────────────────
// 调试日志:BoxJS 设 youpin_debug=true 才打印接口原始响应
function debug(content) {
    if (($.getdata("youpin_debug") || "false") !== "true") return;
    $.log(`[DEBUG] ${typeof content === "string" ? content : JSON.stringify(content)}`);
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
