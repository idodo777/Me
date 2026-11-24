// laifen · Cookie 抓取（Surge 版）
// 原作: MaYIHEI
// 上游来源: https://raw.githubusercontent.com/MaYIHEI/paperclip/refs/heads/main/app/laifen/laifen.js
// 上游更新日期: 2026-10-28
// 转换说明: 由 Egern 版 laifen.js 转换而来。上游脚本逻辑原样保留，仅去掉 Egern 的
//   export default / ctx 环境桥；Surge 原生提供 $request/$response/$persistentStore/$httpClient/
//   $notification/$environment/$argument/$done，Env 类会自动识别 Surge 环境。
//   开关（LAIFEN）由模块 [Script] 的 argument 字段传入（k=v 形式），开头解析后判断，
//   关闭时直接 $done({}) 放行，不抓 Cookie、不通知。
(async function main() {
  // ---------- Surge 参数解析与开关判断 ----------
  function __parseArg(s) {
    const o = {};
    if (typeof s === "string") {
      s.split("&").forEach((kv) => {
        const i = kv.indexOf("=");
        if (i > 0) o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
      });
    } else if (s && typeof s === "object") Object.assign(o, s);
    return o;
  }
  const __arg = __parseArg(typeof $argument !== "undefined" ? $argument : "");
  // LAIFEN 开关关闭时直接放行（http-request/http-response 均原样透传），不抓 Cookie、不通知
  if (__arg.LAIFEN === "false") { $done({}); return; }

  // ---------- 上游脚本（原样） ----------
const $ = new Env("徕芬");

// 签到合集开启「统一通知」时不单独弹通知,结果由签到汇总统一发送
$.merge = typeof $argument === "object" && !!$argument && $argument.merge === true;
if ($.merge) $.msg = (...a) => console.log(a.filter((x) => typeof x === "string" && x).join("\n"));

// 补签入口:请求 http://1.1.1.1/checkin/laifen 时现跑一次签到,跑完把本脚本的签到状态作为响应返回
const CHECKIN_RUN = typeof $request !== "undefined" && /^http:\/\/1\.1\.1\.1\/checkin\//.test($request.url);
if (CHECKIN_RUN) { const end = $.done.bind($); $.done = () => end({ response: { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: $.getdata("laifen_status") || "{}" } }); }

const SCRIPT_VERSION = "2026-10-28.r3"; // 改一次 +1,确认拉到最新版
$.log(`[INFO] 脚本版本 ${SCRIPT_VERSION}`);

const CK_KEY = "laifen_data";
const CLEAR_KEY = "laifen_clear";
const DEBUG_KEY = "laifen_debug";
const STATUS_KEY = "laifen_status";
const APP_GW = "https://app-gw.shuye.com";
const MALL_GW = "https://mall-gw.laifen.net";
// App 请求头里需要原样带上的字段
const APP_HEADERS = ["authorization", "client-code", "device-id", "app-version", "app-code",
    "device-type", "device-name", "device-os-version", "device-model", "user-agent"];
const WEB_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 laifenapp";

if (typeof $request !== "undefined" && !CHECKIN_RUN) {
    getCookie();
    $.done();
} else {
    (async () => {
        if (JSON.parse($.getdata(CLEAR_KEY) || "false")) {
            $.setdata("", CK_KEY);
            $.setdata("false", CLEAR_KEY);
            $.msg($.name, "", "✅ Cookie 已清除，请重新抓取");
            return;
        }
        try {
            await main();
        } catch (e) {
            saveStatus("fail", String(e));
            $.msg($.name, "❌ 运行异常", String(e));
        }
    })().finally(() => $.done());
}

// ─── 抓 Cookie ───────────────────────────────────────────────────────────────
function getCookie() {
    const src = {};
    for (const k of Object.keys($request.headers || {})) src[k.toLowerCase()] = $request.headers[k];
    $.log(`[INFO] 抓取钩子触发 ${$request.url}`);
    if (!/^Bearer\s+\S+/i.test(src.authorization || "")) {
        $.log("[WARN] 请求头没有 Bearer 登录凭据,跳过");
        return;
    }
    const ck = {};
    for (const k of APP_HEADERS) if (src[k]) ck[k] = src[k];

    // 打开 App 会连发几次同一请求,凭据没变就不重复通知
    const old = parseJSON($.getdata(CK_KEY));
    $.setdata(JSON.stringify(ck), CK_KEY);
    if (old && old.authorization === ck.authorization) {
        $.log("[INFO] Cookie 未变化");
        return;
    }
    $.setdata("", STATUS_KEY); // 新 Cookie 待签到验证,先撤掉旧的结果
    $.msg($.name, "✅ 徕芬 Cookie 获取成功", `token: ${mask(ck.authorization.replace(/^Bearer\s+/i, ""))}`);
}

// ─── 签到 ────────────────────────────────────────────────────────────────────
async function main() {
    const ck = parseJSON($.getdata(CK_KEY));
    if (!ck || !ck.authorization) {
        saveStatus("none", "未抓取 Cookie");
        $.msg($.name, "🚫 缺少 Cookie", "请先开启重写规则，打开徕芬 App 进「我的」页");
        return;
    }

    // 1. 续期 App 登录,同时拿到商城凭据
    const r = await request("POST", `${APP_GW}/member/refreshToken`, { ...ck, "content-type": "application/json" }, "");
    if (!r) {
        saveStatus("fail", "续期请求无响应");
        $.msg($.name, "❌ 网络无响应", "续期请求失败，稍后手动运行一次");
        return;
    }
    const d = r.data || {};
    if (r.code !== 200 || !d.access_token || !d.refresh_mall_token) {
        const m = r.msg || JSON.stringify(r).slice(0, 200);
        saveStatus("cookie", `登录失效 ${m}`);
        $.msg($.name, "🚫 Cookie 已失效", `${m}\n请打开徕芬 App 进「我的」页重新抓取`);
        return;
    }
    ck.authorization = `Bearer ${d.access_token}`;
    $.setdata(JSON.stringify(ck), CK_KEY);

    const mall = {
        "authorization": d.refresh_mall_token,
        "accept": "*/*",
        "content-type": "application/json",
        "locale": "zh_CN",
        "origin": "https://mall.laifen.net",
        "referer": "https://mall.laifen.net/",
        "accept-language": "zh-CN,zh-Hans;q=0.9",
        "user-agent": WEB_UA,
    };

    // 2. 查当前签到活动与今日状态
    const cur = await request("GET", `${MALL_GW}/mall_marketing/sc/activity/sign/current`, mall);
    if (!cur) {
        saveStatus("fail", "活动查询无响应");
        $.msg($.name, "❌ 网络无响应", "活动查询失败，稍后手动运行一次");
        return;
    }
    if (cur.code !== "00000" || !cur.data || !cur.data.activityId) {
        const m = cur.msg || JSON.stringify(cur).slice(0, 200);
        saveStatus("fail", `活动查询失败 ${m}`);
        $.msg($.name, "❌ 活动查询失败", m);
        return;
    }
    const act = cur.data;
    const today = (act.calendarList || []).find((x) => x.date === day(Date.now()));
    if (today && today.status === 1) {
        saveStatus("ok", "今日已签到");
        $.msg($.name, "✨ 今日已签到", `本月已签 ${act.monthlySignDays} 天，连签 ${act.continuousDays} 天`);
        return;
    }

    // 3. 签到
    const res = await request("POST", `${MALL_GW}/mall_marketing/sc/activity/sign/do`, mall,
        JSON.stringify({ activityId: act.activityId }));
    if (!res) {
        saveStatus("fail", "签到请求无响应");
        $.msg($.name, "❌ 网络无响应", "签到请求失败，稍后手动运行一次");
        return;
    }
    if (res.code !== "00000" || !res.success) {
        const m = res.msg || JSON.stringify(res).slice(0, 200);
        saveStatus("fail", m);
        $.msg($.name, "❌ 签到失败", m);
        return;
    }
    const data = res.data || {};
    const reward = data.rewardType === 1 ? `+${data.rewardValue} 积分` : `奖励 ${data.rewardValue}`;
    saveStatus("ok", `签到成功 ${reward}`);
    $.msg($.name, "✅ 签到成功", `${reward}，连签 ${data.continuousDays} 天`);
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────
function request(method, url, headers, body) {
    return new Promise((resolve) => {
        const req = { url, headers };
        if (body !== undefined) req.body = body;
        (method === "POST" ? $.post : $.get)(req, (err, resp, data) => {
            if (err) {
                $.log(`[ERROR] ${url} ${err}`);
                return resolve(null);
            }
            debug(`${url} → ${String(data).slice(0, 500)}`);
            const j = parseJSON(data);
            if (!j) $.log(`[ERROR] ${url} 响应不是 JSON: ${String(data).slice(0, 300)}`);
            resolve(j || { msg: `HTTP ${resp && resp.statusCode} ${String(data).slice(0, 100)}` });
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
        const old = parseJSON($.getdata(STATUS_KEY));
        if (old && old.s === "ok" && !/^今日已/.test(old.msg) && day(old.t) === day(Date.now())) keep = old;
    }
    checkinReport(STATUS_KEY, keep ? keepReward(keep, { s, msg }) : { s, msg }, { name: "徕芬", author: "MaYIHEI", run: "http://1.1.1.1/checkin/laifen", open: "https://apps.apple.com/app/id6463205325" });
}

// 北京时间 YYYY-MM-DD
function day(t) {
    return new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function parseJSON(s) {
    try { return JSON.parse(s); } catch (e) { return null; }
}

function mask(s) {
    if (!s || s.length < 12) return "***";
    return s.slice(0, 6) + "..." + s.slice(-4);
}

// 调试日志:BoxJS 设 laifen_debug=true 才打印接口原始响应
function debug(content) {
    if (($.getdata(DEBUG_KEY) || "false") !== "true") return;
    $.log(`[DEBUG] ${content}`);
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
})();
