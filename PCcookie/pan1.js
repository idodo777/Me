// pan1 · Cookie 抓取（Egern 移植版）
// 原作: MaYIHEI
// 上游来源: https://raw.githubusercontent.com/MaYIHEI/paperclip/refs/heads/main/app/pan1/pan1.js
// 上游更新日期: 2026-10-28
// 移植说明: 上游脚本逻辑原样保留，仅在外层把 Surge 环境 API 桥接到 Egern ctx。
export default async function (ctx) {
  if (!(ctx.env && ctx.env.PAN1 === "true")) return {}; // 本应用开关：在模块设置页打开后才抓取

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
const $ = new Env("123社区");

// 签到合集开启「统一通知」时不单独弹通知,结果由签到汇总统一发送
$.merge = typeof $argument === "object" && !!$argument && $argument.merge === true;
if ($.merge) $.msg = (...a) => console.log(a.filter((x) => typeof x === "string" && x).join("\n"));

// 补签入口:请求 http://1.1.1.1/checkin/pan1 时现跑一次签到,跑完把本脚本的签到状态作为响应返回
const CHECKIN_RUN = typeof $request !== "undefined" && /^http:\/\/1\.1\.1\.1\/checkin\//.test($request.url);
if (CHECKIN_RUN) { const end = $.done.bind($); $.done = () => end({ response: { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: $.getdata("pan1_status") || "{}" } }); }

const SCRIPT_VERSION = "2026-10-28.r3"; // 改一次 +1,确认拉到最新版
$.log(`[INFO] 脚本版本 ${SCRIPT_VERSION}`);

const CK_KEY = "pan1_data";
const CLEAR_KEY = "pan1_clear";
const DEBUG_KEY = "pan1_debug";
const SIGN_URL = "https://pan1.me/?my-sign.htm";
const UA_FALLBACK = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

if (typeof $request !== "undefined" && !CHECKIN_RUN) {
    capture();
} else if (JSON.parse($.getdata(CLEAR_KEY) || "false")) {
    $.setdata("", CK_KEY);
    $.setdata("false", CLEAR_KEY);
    $.msg($.name, "", "✅ Cookie 已清除，请重新抓取");
    $.done();
} else {
    run().finally(() => $.done());
}

function capture() {
    $.log(`[INFO] 抓取钩子命中 ${String($request.url || "").replace(/\?.*$/, "")}`);
    const headers = $request.headers || {};
    const cookie = normalizeCookie(header(headers, "cookie"));
    const token = cookieValue(cookie, "bbs_token");
    if (!token || token === "deleted") {
        debug(`未找到有效 bbs_token，Cookie keys=${cookieKeys(cookie)}`);
        $.done();
        return;
    }

    const data = {
        cookie: `bbs_token=${token}`,
        ua: header(headers, "user-agent") || UA_FALLBACK,
        capturedAt: Date.now(),
    };
    const previous = $.getdata(CK_KEY);
    let changed = true;
    try {
        changed = JSON.parse(previous || "null").cookie !== data.cookie;
    } catch (_) {}
    const ok = $.setdata(JSON.stringify(data), CK_KEY);
    if (!ok || !$.getdata(CK_KEY)) {
        $.msg($.name, "❌ Cookie 保存失败", "请查看脚本日志后重试");
    } else if (changed) {
        $.setdata("", "pan1_status"); // 新 Cookie 待签到验证,先撤掉旧的体检结果
        $.msg($.name, "", "✅ 123社区 Cookie 获取成功");
    }
    $.done();
}

async function run() {
    const raw = $.getdata(CK_KEY);
    if (!raw) {
        saveStatus("none", "未抓取 Cookie");
        $.msg($.name, "🚫 缺少 Cookie", "请先用 Safari 登录 123网盘社区并打开任意页面");
        return;
    }

    let auth;
    try {
        auth = JSON.parse(raw);
    } catch (_) {
        saveStatus("cookie", "Cookie 解析失败");
        $.msg($.name, "🚫 Cookie 解析失败", "请在 BoxJS 清除后重新抓取");
        return;
    }
    if (!/^bbs_token=.+/.test(auth.cookie || "")) {
        saveStatus("cookie", "Cookie 不完整");
        $.msg($.name, "🚫 Cookie 不完整", "请重新登录 123网盘社区并打开任意页面");
        return;
    }

    const result = await signWithRetry(auth);
    if (result.error) {
        saveStatus("fail", "网络错误,已重试 3 次");
        $.msg($.name, "❌ 签到失败", `网络错误，已重试 3 次\n${result.error.slice(0, 100)}`);
        return;
    }
    debug(`status=${result.status} body=${String(result.body).slice(0, 500)}`);
    if (result.status < 200 || result.status >= 300) {
        saveStatus("fail", `HTTP ${result.status}`);
        $.msg($.name, "❌ 签到失败", `HTTP ${result.status}，请稍后重试`);
        return;
    }

    let data;
    try {
        data = JSON.parse(result.body);
    } catch (_) {
        const text = stripHtml(result.body);
        saveStatus(/登录|login/i.test(text) ? "cookie" : "fail", /登录|login/i.test(text) ? "Cookie 已失效" : "响应解析失败");
        if (/登录|login/i.test(text)) {
            $.msg($.name, "🚫 Cookie 已失效", "请重新登录 123网盘社区并打开任意页面");
        } else {
            $.msg($.name, "❌ 响应解析失败", text.slice(0, 120) || "服务端返回空响应");
        }
        return;
    }

    const message = String(data.message || data.msg || "").replace(/<br\s*\/?>/gi, " ").trim();
    if (String(data.code) === "0") {
        saveStatus("ok", message || "签到成功");
        $.msg($.name, "✅ 签到成功", message || "经验和金币已到账");
    } else if (/已签到|已经签到|今日.*签|重复/i.test(message)) {
        saveStatus("ok", "今日已签到");
        $.msg($.name, "✨ 今日已签到", message);
    } else if (/登录|用户不存在|权限|login/i.test(message)) {
        saveStatus("cookie", "Cookie 已失效");
        $.msg($.name, "🚫 Cookie 已失效", "请重新登录 123网盘社区并打开任意页面");
    } else {
        saveStatus("fail", message || `code=${data.code}`);
        $.msg($.name, "❌ 签到失败", message || `code=${data.code}`);
    }
}

async function signWithRetry(auth) {
    const delays = [0, 3000, 6000];
    let last = { status: 0, body: "", error: "网络无响应" };
    for (let i = 0; i < delays.length; i++) {
        if (delays[i]) await sleep(delays[i]);
        last = await signOnce(auth);
        const retryable = !!last.error || last.status === 0 || last.status >= 500;
        if (!retryable) return last;
        $.log(`[WARN] 签到网络错误(${i + 1}/${delays.length}): ${last.error || `HTTP ${last.status}`}`);
    }
    return last;
}

function signOnce(auth) {
    return new Promise((resolve) => {
        $.post({
            url: SIGN_URL,
            headers: {
                accept: "application/json, text/javascript, */*; q=0.01",
                cookie: auth.cookie,
                origin: "https://pan1.me",
                referer: "https://pan1.me/",
                "user-agent": auth.ua || UA_FALLBACK,
                "x-requested-with": "XMLHttpRequest",
            },
            body: "",
        }, (err, resp, body) => {
            if (err) {
                resolve({ status: 0, body: body || "", error: errorText(err) });
                return;
            }
            resolve({
                status: Number((resp && (resp.status || resp.statusCode)) || 0),
                body: body || "",
                error: "",
            });
        });
    });
}

// 记录本次结果,供「签到汇总」:ok 正常 / cookie 需重新抓取 / fail 其他失败 / none 未使用
function saveStatus(s, msg) {
    msg = String(msg).slice(0, 100);
    // 服务器明确提示登录过期的失败,按需要重新抓取处理
    if (s === "fail" && /过期|重新登录|未登录|请登录|登录失效|登录已失效|token\s*(失效|过期|无效)|not\s*login/i.test(msg)) s = "cookie";
    // 同一天已有带奖励的成功记录时,再次运行得到的「今日已签」不覆盖它的奖励文字,只合并本次的资产等信息
    let keep = null;
    if (s === "ok" && /^今日已/.test(msg)) {
        const day = (t) => new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
        let old = null;
        try { old = JSON.parse($.getdata("pan1_status") || "null"); } catch (e) {}
        if (old && old.s === "ok" && !/^今日已/.test(old.msg) && day(old.t) === day(Date.now())) keep = old;
    }
    checkinReport("pan1_status", keep ? keepReward(keep, { s, msg }) : { s, msg }, { name: "123社区", author: "MaYIHEI", run: "http://1.1.1.1/checkin/pan1", open: "https://pan1.me" });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(error) {
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch (_) {
        return String(error);
    }
}

function header(headers, name) {
    const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase());
    return key ? String(headers[key] || "") : "";
}

function normalizeCookie(raw) {
    return String(raw || "")
        .replace(/\r?\n(?:cookie:\s*)?/gi, "; ")
        .split(";")
        .map((item) => item.trim().replace(/^cookie:\s*/i, ""))
        .filter(Boolean)
        .join("; ");
}

function cookieValue(cookie, name) {
    const prefix = `${name}=`;
    const item = String(cookie || "").split(/;\s*/).find((part) => part.startsWith(prefix));
    return item ? item.slice(prefix.length) : "";
}

function cookieKeys(cookie) {
    return String(cookie || "").split(/;\s*/).map((item) => item.split("=")[0]).filter(Boolean).join(",");
}

function stripHtml(text) {
    return String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function debug(message) {
    if (($.getdata(DEBUG_KEY) || "false") === "true") $.log(`[DEBUG] ${message}`);
}

// 保留当天带奖励的旧记录(状态、奖励文字、时间),合并本次拿到的资产、过期时间等;本次没有的沿用旧值
function keepReward(old, rec) {
    const out = { s: old.s, msg: old.msg, t: old.t, asset: old.asset, exp: old.exp };
    for (const k in rec) if (rec[k] !== undefined && k !== "s" && k !== "msg") out[k] = rec[k];
    return out;
}

// 签到状态协议 v1:写本次结果,并把自己登记进公共索引 checkin_registry(Loon/Surge/QX/Stash 通用,不依赖 Env)
function checkinReport(key, rec, info) {
    const read = (k) => (typeof $prefs !== "undefined" ? $prefs.valueForKey(k) : $persistentStore.read(k));
    const write = (v, k) => (typeof $prefs !== "undefined" ? $prefs.setValueForKey(v, k) : $persistentStore.write(v, k));
    const registry = () => { try { return JSON.parse(read("checkin_registry") || "{}") || {}; } catch (e) { return {}; } };
    write(JSON.stringify(Object.assign({ v: 1, t: Date.now(), name: info.name, author: info.author }, rec)), key);
    const reg = registry();
    if (JSON.stringify(reg[key]) === JSON.stringify(info)) return;
    reg[key] = info;
    write(JSON.stringify(reg), "checkin_registry");
    if (!registry()[key]) console.log(`[checkin] ${key} 登记没写上,下次运行再补`);
}

function Env(s) {
    this.name = s;
    this.isSurge = () => typeof $httpClient !== "undefined";
    this.isQuanX = () => typeof $task !== "undefined";
    this.isLoon = () => typeof $loon !== "undefined";
    this.log = (...a) => console.log(a.join("\n"));
    this.msg = (t = this.name, s = "", b = "") => {
        if (this.isSurge() || this.isLoon()) $notification.post(t, s, b);
        else if (this.isQuanX()) $notify(t, s, b);
        console.log(["", `====📣${t}====`, s, b].filter(Boolean).join("\n"));
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
    this.post = (req, cb) => this.send(req, "POST", cb);
    this.send = (req, method, cb) => {
        if (this.isSurge() || this.isLoon()) {
            const fn = method === "POST" ? $httpClient.post : $httpClient.get;
            fn(req, (err, resp, data) => {
                if (resp) {
                    resp.body = data;
                    resp.statusCode = resp.status || resp.statusCode;
                }
                cb(err, resp, data);
            });
        } else if (this.isQuanX()) {
            req.method = method;
            $task.fetch(req).then(
                (r) => {
                    r.status = r.statusCode;
                    cb(null, r, r.body);
                },
                (e) => cb(e.error || e, null, null),
            );
        }
    };
    this.done = (v = {}) => {
        if (typeof $done !== "undefined") $done(v);
    };
}


  // ---------- 等待上游收尾 ----------
  await __donePromise;
  return {};
}
