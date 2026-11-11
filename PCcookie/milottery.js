// milottery · Cookie 抓取（Egern 移植版）
// 原作: MaYIHEI
// 上游来源: https://raw.githubusercontent.com/MaYIHEI/paperclip/refs/heads/main/app/milottery/milottery.js
// 上游更新日期: 2026-10-28
// 移植说明: 上游脚本逻辑原样保留，仅在外层把 Surge 环境 API 桥接到 Egern ctx。
export default async function (ctx) {
  if (!(ctx.env && ctx.env.MILOTTERY === "true")) return {}; // 本应用开关：在模块设置页打开后才抓取

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
const $ = new Env("小米抽奖");

// 签到合集开启「统一通知」时不单独弹通知,结果由签到汇总统一发送
$.merge = typeof $argument === "object" && !!$argument && $argument.merge === true;
if ($.merge) $.msg = (...a) => console.log(a.filter((x) => typeof x === "string" && x).join("\n"));

const SCRIPT_VERSION = "2026-10-28.r3"; // 改一次 +1,确认拉到最新版
$.log(`[INFO] 脚本版本 ${SCRIPT_VERSION}`);

const CK_KEY = "milottery_data";
const API = "https://shop-api.retail.mi.com";
const ACT_API = "https://act-api.retail.mi.com";
const BATCH_PATH = "/mtop/navi/venue/batch";
const SUPPORTED_TASK_TYPES = [101, 110, 200];
const MAX_DETAIL_QUERIES = 8;

if (typeof $request !== "undefined") {
    capture();
} else if (JSON.parse($.getdata("milottery_clear") || "false")) {
    $.setdata("", CK_KEY);
    $.setdata("false", "milottery_clear");
    $.msg($.name, "", "✅ Cookie 已清除，请重新抓取");
    $.done();
} else {
    run().finally(() => $.done());
}

function capture() {
    $.log(`[INFO] 抓取钩子命中 ${$request.url}`);
    const body = $request.body || "";
    const query = taskQuery(body);
    if (!query) {
        $.done();
        return;
    }

    const headers = cleanHeaders($request.headers || {});
    const cookie = normalizeCookie(header(headers, "cookie"));
    if (!cookie) {
        $.msg($.name, "❌ Cookie 获取失败", "活动请求中没有 Cookie，请确认已登录小米商城");
        $.done();
        return;
    }

    setHeader(headers, "cookie", cookie);
    const capturedAt = Date.now();
    const url = ($request.url || API + BATCH_PATH).replace(/\?.*$/, "");
    let saved = null;
    try {
        saved = JSON.parse($.getdata(CK_KEY) || "null");
    } catch (e) {
        debug(`saved data parse error: ${e.message || e}`);
    }

    if (!query.isMain) {
        if (!saved || !saved.body || query.actId === saved.actId) {
            $.done();
            return;
        }
        if (header(headers, "mishop-client-id") || !saved.headers) saved.headers = headers;
        else setHeader(saved.headers, "cookie", cookie);
        saved.url = url;
        saved.capturedAt = capturedAt;
        saved.detailQueries = upsertDetailQuery(saved.detailQueries, query, body, capturedAt);
        $.setdata(JSON.stringify(saved), CK_KEY);
        $.done();
        return;
    }

    const current = {
        url,
        headers,
        body,
        actId: query.actId,
        capturedAt,
        detailQueries: saved && saved.actId === query.actId ? saved.detailQueries || [] : [],
    };

    let data = current;
    let notify = true;
    const sameActivity = saved && saved.actId === current.actId;
    const currentNative = !!header(current.headers, "mishop-client-id");
    if (sameActivity && !currentNative) {
        data = saved;
        setHeader(data.headers, "cookie", cookie);
        data.capturedAt = current.capturedAt;
        notify = false;
    } else if (sameActivity && currentNative) {
        notify = false;
    }

    const ok = $.setdata(JSON.stringify(data), CK_KEY);
    const persisted = $.getdata(CK_KEY);
    if (ok && persisted && notify) {
        $.setdata("", "milottery_status"); // 新 Cookie 待签到验证,先撤掉旧的体检结果
        $.msg($.name, "", "✅ 小米抽奖 Cookie 获取成功");
    } else if (!ok || !persisted) {
        $.msg($.name, "❌ Cookie 保存失败", "请查看脚本日志后重试");
    }
    $.done();
}

async function run() {
    const raw = $.getdata(CK_KEY);
    if (!raw) {
        saveStatus("none", "未抓取 Cookie");
        $.msg($.name, "🚫 缺少 Cookie", "请先进入小米商城 APP → 狂欢礼 → 抽奖活动页抓取");
        return;
    }

    let auth;
    try {
        auth = JSON.parse(raw);
    } catch (e) {
        saveStatus("cookie", "Cookie 解析失败");
        $.msg($.name, "🚫 Cookie 解析失败", "请清除后重新抓取");
        return;
    }
    if (!auth.body || !header(auth.headers || {}, "cookie")) {
        saveStatus("cookie", "Cookie 不完整");
        $.msg($.name, "🚫 Cookie 不完整", "请重新进入抽奖活动页抓取");
        return;
    }

    const first = await queryTasks(auth);
    if (!first) return;
    const detailResults = await queryDetailTasks(auth);
    let tasks = mergeTasks([extractTasks(first), ...detailResults.map(extractTasks)]);
    const lottery = tasks.find((task) => Number(task.taskType) === 128);
    if (!lottery) {
        saveStatus("cookie", "未找到抽奖活动,需重进活动页抓取");
        $.msg($.name, "⚠️ 未找到抽奖活动", "活动配置可能已更新，请重进活动页抓取");
        debug(`task query raw: ${JSON.stringify(first).slice(0, 500)}`);
        return;
    }

    const now = Number(lottery.serverTime || Date.now());
    if ((lottery.startTime && now < lottery.startTime) || (lottery.endTime && now > lottery.endTime)) {
        saveStatus("cookie", "活动不在有效期,需重进活动页抓取");
        $.msg($.name, "⚠️ 活动不在有效期", "请进入当前抽奖活动页重新抓取配置");
        return;
    }

    const taskResult = { done: 0, skipped: 0, failed: [] };
    let actionCount = 0;
    const actionable = tasks
        .filter((item) => SUPPORTED_TASK_TYPES.includes(Number(item.taskType)))
        .sort((a, b) => taskPriority(a) - taskPriority(b));
    for (const task of actionable) {
        if (!isTaskActive(task)) {
            taskResult.skipped++;
            continue;
        }
        const remaining = Math.max(0, Number(task.totalNumber || 0) - Number(task.finishedNumber || 0));
        if (!remaining) {
            taskResult.skipped++;
            continue;
        }
        const count = Math.min(remaining, Number(task.upperLimit || remaining), 10);
        for (let i = 0; i < count; i++) {
            if (actionCount > 0) {
                const gap = randomInt(1200, 3500);
                debug(`task gap ${gap}ms`);
                await sleep(gap);
            }
            const result = await completeTask(auth, task);
            actionCount++;
            if (result.ok) taskResult.done++;
            else {
                taskResult.failed.push(`${task.taskName || task.taskId}: ${result.message}`);
                break;
            }
        }
    }

    const refreshed = await queryTasks(auth);
    if (!refreshed) return;
    tasks = extractTasks(refreshed);
    const drawTask = tasks.find((task) => Number(task.taskType) === 128);
    if (!drawTask) {
        saveStatus("fail", "重新查询后未找到抽奖任务");
        $.msg($.name, "⚠️ 任务已处理", "重新查询后未找到抽奖任务");
        return;
    }

    const singleCost = Math.max(1, Number(drawTask.singleCostScores || 1));
    const available = Math.floor(Number(drawTask.scores || 0) / singleCost);
    const drawLimit = Math.max(0, Number(drawTask.totalNumber || 0) - Number(drawTask.finishedNumber || 0));
    const drawCount = Math.min(available, drawLimit, 30);
    const drawResult = { count: 0, empty: 0, prizes: [], failed: "" };

    for (let i = 0; i < drawCount; i++) {
        const result = await draw(auth, drawTask);
        if (!result.ok) {
            drawResult.failed = result.message;
            break;
        }
        drawResult.count++;
        const awards = result.awards.filter((award) => Number(award.awardType) !== 0);
        if (!awards.length) drawResult.empty++;
        for (const award of awards) {
            const name = award.customAwardName || award.awardName || "奖励";
            const value = award.awardValue && award.awardValue !== "1" ? ` +${award.awardValue}` : "";
            drawResult.prizes.push(`${name}${value}`);
        }
        if (i + 1 < drawCount) await sleep(2800);
    }

    const lines = [
        `任务完成 ${taskResult.done} 次${taskResult.skipped ? ` · 已完成 ${taskResult.skipped} 项` : ""}`,
        `抽奖 ${drawResult.count}/${drawCount} 次${drawResult.empty ? ` · 未中奖 ${drawResult.empty} 次` : ""}`,
    ];
    if (drawResult.prizes.length) lines.push(`🎁 ${drawResult.prizes.join("、")}`);
    if (taskResult.failed.length) lines.push(`⚠️ ${taskResult.failed[0]}`);
    if (drawResult.failed) lines.push(`⚠️ 抽奖中止: ${drawResult.failed}`);

    const ok = !taskResult.failed.length && !drawResult.failed;
    saveStatus("ok", lines.join(" · ")); // 部分任务失败不代表 Cookie 有问题,详情见当次通知
    $.msg($.name, ok ? "✅ 执行完成" : "⚠️ 部分完成", lines.join("\n"));
}

async function queryTasks(auth, body = auth.body, quiet = false) {
    const result = await request(auth.url || API + BATCH_PATH, auth.headers, body);
    if (!result) {
        if (!quiet) {
            saveStatus("fail", "查询任务失败:网络无响应");
            $.msg($.name, "❌ 查询任务失败", "网络无响应，请稍后重试");
        }
        return null;
    }
    if (Number(result.code) !== 0) {
        const message = result.message || result.msg || "未知错误";
        if (!quiet) {
            saveStatus("fail", `查询任务失败:${message}`);
            $.msg($.name, "❌ 查询任务失败", `${message}；若提示未登录，请重进活动页抓取`);
        }
        debug(`query raw: ${JSON.stringify(result).slice(0, 500)}`);
        return null;
    }
    return result;
}

async function queryDetailTasks(auth) {
    const results = [];
    for (const item of auth.detailQueries || []) {
        if (!item || !item.body) continue;
        const result = await queryTasks(auth, item.body, true);
        if (result) results.push(result);
    }
    return results;
}

async function completeTask(auth, task) {
    const start = await post(auth, "/mtop/mf/act/infinite/do", [
        {},
        { actId: task.actId, taskId: task.taskId },
    ]);
    if (!start || Number(start.code) !== 0 || !start.data || !start.data.taskToken) {
        return { ok: false, message: messageOf(start) };
    }

    if (Number(task.taskType) === 200) {
        const minSeconds = Math.max(5, Math.ceil(Number(task.duration || 5)));
        const wait = randomInt(minSeconds * 1000, (minSeconds + 3) * 1000);
        debug(`browse wait ${wait}ms: ${task.taskName || task.taskId}`);
        await sleep(wait);
        const taskApi = Number(task.subType) === 2 ? ACT_API : API;
        const extraHeaders = taskApi === ACT_API ? { needlogin: "true" } : {};
        const done = await post(auth, "/mtop/act/lego/task/done/v2", [
            {},
            { taskToken: start.data.taskToken, taskType: String(task.taskType) },
        ], taskApi, extraHeaders);
        return { ok: !!done && Number(done.code) === 0, message: messageOf(done) };
    }

    await sleep(1200);
    const done = await post(auth, "/mtop/mf/act/infinite/done", [
        {},
        { taskToken: start.data.taskToken, actId: task.actId, taskType: task.taskType },
    ]);
    return { ok: !!done && Number(done.code) === 0, message: messageOf(done) };
}

async function draw(auth, task) {
    const start = await post(auth, "/mtop/mf/act/infinite/do", [
        {},
        { actId: task.actId, taskId: task.taskId },
    ]);
    if (!start || Number(start.code) !== 0 || !start.data || !start.data.taskToken) {
        return { ok: false, message: messageOf(start), awards: [] };
    }
    const done = await post(auth, "/mtop/mf/act/infinite/done", [
        {},
        {
            actId: task.actId,
            taskToken: start.data.taskToken,
            taskType: task.taskType,
            extra: { privacyAuth: true },
        },
    ]);
    return {
        ok: !!done && Number(done.code) === 0,
        message: messageOf(done),
        awards: (done && done.data && done.data.awardList) || [],
    };
}

function post(auth, path, body, baseUrl = API, extraHeaders = {}) {
    return request(baseUrl + path, auth.headers, JSON.stringify(body), extraHeaders);
}

function request(url, sourceHeaders, body, extraHeaders = {}) {
    return new Promise((resolve) => {
        const headers = cleanHeaders(sourceHeaders || {});
        setHeader(headers, "content-type", "application/json");
        Object.keys(extraHeaders).forEach((key) => setHeader(headers, key, extraHeaders[key]));
        const opts = { url, headers, body };
        $.post(opts, (err, resp, data) => {
            if (err) {
                debug(`[${url}] request error: ${JSON.stringify(err)}`);
                resolve(null);
                return;
            }
            try {
                resolve(JSON.parse(data));
            } catch (e) {
                debug(`[${url}] parse error status=${resp && resp.statusCode}: ${(data || "").slice(0, 300)}`);
                resolve(null);
            }
        });
    });
}

function extractTasks(root) {
    const tasks = new Map();
    const walk = (value) => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) {
            value.forEach(walk);
            return;
        }
        if (value.taskId && value.actId && value.taskType !== undefined) {
            const previous = tasks.get(value.taskId);
            if (!previous || Number(value.serverTime || 0) >= Number(previous.serverTime || 0)) {
                tasks.set(value.taskId, value);
            }
        }
        Object.keys(value).forEach((key) => walk(value[key]));
    };
    walk(root);
    return Array.from(tasks.values());
}

function mergeTasks(groups) {
    const tasks = new Map();
    groups.forEach((group) => (group || []).forEach((task) => {
        if (!task || !task.taskId) return;
        const previous = tasks.get(task.taskId);
        if (!previous || Number(task.serverTime || 0) >= Number(previous.serverTime || 0)) {
            tasks.set(task.taskId, task);
        }
    }));
    return Array.from(tasks.values());
}

function taskQuery(body) {
    if (!body || !/infinite-task/.test(body)) return null;
    try {
        const parsed = JSON.parse(body);
        const list = parsed.query_list || (Array.isArray(parsed) && parsed[1] && parsed[1].query_list) || [];
        for (const item of list) {
            if (!item || item.resolver !== "infinite-task") continue;
            const parameter = typeof item.parameter === "string" ? JSON.parse(item.parameter) : item.parameter;
            if (!parameter || !parameter.actId) continue;
            const taskIds = Array.isArray(parameter.taskIdList) ? parameter.taskIdList.map(String) : [];
            const types = (parameter.taskTypeList || []).map(Number);
            const isMain = !taskIds.length && [128, 200].every((type) => types.includes(type));
            if (isMain || taskIds.length) return { actId: String(parameter.actId), taskIds, isMain };
        }
        return null;
    } catch (e) {
        return null;
    }
}

function upsertDetailQuery(items, query, body, capturedAt) {
    const key = `${query.actId}:${query.taskIds.join(",")}`;
    const result = (items || []).filter((item) => item && item.key !== key);
    result.push({ key, body, capturedAt });
    return result.slice(-MAX_DETAIL_QUERIES);
}

function taskPriority(task) {
    const priority = { 110: 0, 101: 1, 200: 2 }[Number(task.taskType)];
    return priority === undefined ? 9 : priority;
}

function isTaskActive(task) {
    const now = Number(task.serverTime || Date.now());
    return !(task.startTime && now < Number(task.startTime)) && !(task.endTime && now > Number(task.endTime));
}

function cleanHeaders(source) {
    const result = {};
    Object.keys(source || {}).forEach((key) => {
        if (/^(content-length|host|connection|accept-encoding)$/i.test(key) || key.startsWith(":")) return;
        result[key] = source[key];
    });
    return result;
}

function header(headers, name) {
    const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : "";
}

function setHeader(headers, name, value) {
    const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase());
    headers[key || name] = value;
}

function normalizeCookie(raw) {
    const values = Array.isArray(raw) ? raw : [raw || ""];
    return values
        .join("\n")
        .split(/\r?\n/)
        .map((line) => line.replace(/^cookie:\s*/i, "").trim())
        .filter(Boolean)
        .join("; ")
        .replace(/;\s*;/g, ";");
}

function messageOf(result) {
    if (!result) return "网络无响应";
    return result.message || result.msg || `code=${result.code}`;
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
        try { old = JSON.parse($.getdata("milottery_status") || "null"); } catch (e) {}
        if (old && old.s === "ok" && !/^今日已/.test(old.msg) && day(old.t) === day(Date.now())) keep = old;
    }
    checkinReport("milottery_status", keep ? keepReward(keep, { s, msg }) : { s, msg }, { name: "小米抽奖", author: "MaYIHEI", open: "https://apps.apple.com/app/id1024958046" });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function debug(content) {
    if (($.getdata("milottery_debug") || "false") !== "true") return;
    $.log(`[DEBUG] ${typeof content === "string" ? content : JSON.stringify(content)}`);
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
    this.log = (...args) => console.log(args.join("\n"));
    this.msg = (title = this.name, subtitle = "", body = "") => {
        if (this.isSurge() || this.isLoon()) $notification.post(title, subtitle, body);
        else if (this.isQuanX()) $notify(title, subtitle, body);
        console.log(["", `====📣${title}====`, subtitle, body].filter(Boolean).join("\n"));
    };
    this.getdata = (key) => {
        if (this.isSurge() || this.isLoon()) return $persistentStore.read(key);
        if (this.isQuanX()) return $prefs.valueForKey(key);
        return null;
    };
    this.setdata = (value, key) => {
        if (this.isSurge() || this.isLoon()) return $persistentStore.write(value, key);
        if (this.isQuanX()) return $prefs.setValueForKey(value, key);
        return false;
    };
    this.post = (request, callback) => this.send(request, "POST", callback);
    this.send = (request, method, callback) => {
        if (this.isSurge() || this.isLoon()) {
            const fn = method === "POST" ? $httpClient.post : $httpClient.get;
            fn(request, (error, response, data) => {
                if (response) {
                    response.body = data;
                    response.statusCode = response.status || response.statusCode;
                }
                callback(error, response, data);
            });
        } else if (this.isQuanX()) {
            request.method = method;
            $task.fetch(request).then(
                (response) => callback(null, response, response.body),
                (error) => callback(error.error || error, null, null)
            );
        }
    };
    this.done = (value = {}) => {
        if (typeof $done !== "undefined") $done(value);
    };
}


  // ---------- 等待上游收尾 ----------
  await __donePromise;
  return {};
}
