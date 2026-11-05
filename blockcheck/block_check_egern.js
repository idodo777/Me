/*
 * ============================================================
 * 节点阻断检测（Egern 版）
 * ============================================================
 * 原作者：RavelloH（https://github.com/RavelloH）
 * 原版：Quantumult X event-interaction 脚本 block_check.js（同目录存档）
 * 功能：检测某个节点是真的挂了，还是被 GFW / 运营商屏蔽。
 *
 * 检测方法（与原版一致，三方交叉验证）：
 * 1) 经该节点访问 ip-api.com —— 通不通、出口 IP 是哪；
 * 2) 本机直连 ip-api.com —— 排除本机断网；
 * 3) check-host.net 海外多点 TCP 探测节点地址 —— 全球都通就不是节点死了；
 * 4) 仅当「海外能通 + 国内经节点不通」时，再用 Globalping 的国内
 *    电信/联通/移动探针定位：三家都不通 = GFW 全局阻断；
 *    只有某家不通 = 运营商级拦截；三家都通 = 不是拦截，查客户端配置。
 *
 * 与原版的两点差异（QuanX 机制在 Egern 不存在，只能换等价物）：
 * - 原版靠「长按节点 → 执行脚本」把节点名传入，并用 QuanX 私有接口
 *   读出节点地址；Egern 没有这两个接口，改为在 Env 里配置要测的节点：
 *     POLICY = 节点或策略组名称（要与 Egern 配置里的名字一字不差）
 *     HOST   = 节点服务器地址（域名或 IP）
 *     PORT   = 节点端口
 *     NAME   = 显示名（可选，默认用 POLICY）
 * - 原版结果显示在 QuanX 的 HTML 面板里；Egern 版改为发通知 + 写日志，
 *   结论在通知第一行。
 *
 * 移植时修掉原版一个 bug：check-host 对探测失败的节点返回 [null]，
 * 原版读 nr[0].time 会抛错且无人接住，整个脚本无声卡死（恰好发生在
 * 「节点离线」这个最需要结论的场景）；本版已加空值守卫。
 * 另给 check-host / Globalping 请求加了浏览器 UA，避免被其机器人过滤误拦。
 * ============================================================
 */

const IP_API = "http://ip-api.com/json?lang=zh-CN";
const CHECK_HOST = "https://check-host.net";
const GP_API = "https://api.globalping.io/v1/measurements";
const TIMEOUT = 8000;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- 三条检测线 ---------- */

// 1) 经节点访问 ip-api
async function checkViaNode(ctx, policy) {
    try {
        const res = await ctx.http.get(IP_API, { policy: policy, timeout: TIMEOUT });
        const data = await res.json();
        return { ok: true, data: data };
    } catch (e) {
        return { ok: false };
    }
}

// 2) 本机直连 ip-api
async function checkDirect(ctx) {
    try {
        const res = await ctx.http.get(IP_API, { timeout: TIMEOUT });
        const data = await res.json();
        return { ok: true, data: data };
    } catch (e) {
        return { ok: false };
    }
}

// 3) check-host.net 海外多点 TCP 探测
async function checkRemote(ctx, host, port) {
    const headers = { "Accept": "application/json", "User-Agent": UA };
    try {
        const target = host + ":" + port;
        const submitRes = await ctx.http.get(
            CHECK_HOST + "/check-tcp?host=" + encodeURIComponent(target) + "&max_nodes=10",
            { headers: headers, timeout: TIMEOUT }
        );
        const d = await submitRes.json();
        if (!d || !d.ok || !d.request_id) return { ok: false, error: "提交失败" };

        const nodeList = d.nodes || {};
        const nodeNames = Object.keys(nodeList);
        const countryMap = {};
        nodeNames.forEach(function (n) {
            const info = nodeList[n];
            if (info && info.length >= 1) countryMap[n] = info[0];
        });

        await sleep(3500);

        const resultRes = await ctx.http.get(
            CHECK_HOST + "/check-result/" + d.request_id,
            { headers: headers, timeout: TIMEOUT }
        );
        const res = await resultRes.json();

        let reachable = false;
        const items = [];
        nodeNames.forEach(function (n) {
            const cc = countryMap[n] || "";
            const flag = cc ? getFlag(cc) : "🌍";
            let ms = "--.--ms";
            const nr = res ? res[n] : null;
            // 修复点：nr[0] 可能为 null（该探测点失败时 check-host 返回 [null]）
            if (nr && Array.isArray(nr) && nr.length > 0 && nr[0] && nr[0].time !== undefined) {
                reachable = true;
                ms = formatMs(nr[0].time * 1000);
            }
            items.push({ flag: flag, ms: ms });
        });
        return { ok: reachable, data: items };
    } catch (e) {
        return { ok: false, error: "请求失败" };
    }
}

// 4) Globalping 国内三网探针（仅阻断嫌疑时调用）
async function fetchGlobalping(ctx, host, port) {
    const body = {
        type: "ping",
        target: host,
        measurementOptions: { port: parseInt(port), protocol: "TCP" },
        locations: [{ country: "CN", tags: ["eyeball-network"] }],
        limit: 12
    };
    try {
        const createRes = await ctx.http.post(GP_API, {
            headers: { "Content-Type": "application/json", "User-Agent": UA },
            body: JSON.stringify(body),
            timeout: TIMEOUT
        });
        const d = await createRes.json();
        if (!d || !d.id) return null;

        await sleep(6000);

        const resultRes = await ctx.http.get(GP_API + "/" + d.id, {
            headers: { "Accept": "application/json", "User-Agent": UA },
            timeout: TIMEOUT
        });
        return await resultRes.json();
    } catch (e) {
        return null;
    }
}

/* ---------- 与原版逐字一致的纯逻辑 ---------- */

function classifyISP(network) {
    const n = (network || "").toLowerCase();
    if (n.indexOf("unicom") !== -1 || n.indexOf("china unicom") !== -1) return "中国联通";
    if (n.indexOf("chinanet") !== -1 || n.indexOf("telecom") !== -1 || n.indexOf("china telecom") !== -1) return "中国电信";
    if (n.indexOf("mobile") !== -1 || n.indexOf("china mobile") !== -1) return "中国移动";
    return null;
}

function analyzeBlockSource(gpData) {
    const results = gpData.results;
    if (!results) return null;

    const ispGroups = {};
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const isp = classifyISP(r.probe.network);
        if (!isp) continue;

        if (!ispGroups[isp]) ispGroups[isp] = { probes: [], reachable: false };

        const res = r.result;
        let ok = false;
        let ms = "--.--ms";
        const stats = res.stats;
        if (res.status === "finished" && stats) {
            ok = stats.rcv > 0;
            ms = ok ? formatMs(stats.avg || 0) : "--.--ms";
        }
        if (ok) ispGroups[isp].reachable = true;

        ispGroups[isp].probes.push({
            city: cnCity(r.probe.city),
            ok: ok,
            ms: ms
        });
    }

    const reachableIsps = [], blockedIsps = [];
    const keys = Object.keys(ispGroups);
    for (let k = 0; k < keys.length; k++) {
        const g = ispGroups[keys[k]];
        if (g.probes.length === 0) continue;
        if (g.reachable) reachableIsps.push(keys[k]); else blockedIsps.push(keys[k]);
    }

    let conclusion;
    if (reachableIsps.length === 0) {
        conclusion = "🚫 GFW 全局阻断 — 国内三大运营商均无法访问";
    } else if (blockedIsps.length > 0) {
        conclusion = "🚫 运营商级拦截 — " + blockedIsps.join("、") + " 不可达，" + reachableIsps.join("、") + " 正常";
    } else {
        conclusion = "✅ 国内三大运营商全部可达，非 GFW 或运营商拦截，请检查客户端配置";
    }

    return { ispGroups: ispGroups, conclusion: conclusion };
}

function cnCity(en) {
    const map = {
        "Beijing": "北京", "Shanghai": "上海", "Guangzhou": "广州",
        "Shenzhen": "深圳", "Chengdu": "成都", "Hangzhou": "杭州",
        "Wuhan": "武汉", "Nanjing": "南京", "Tianjin": "天津",
        "Xi'an": "西安", "Changsha": "长沙", "Zhengzhou": "郑州",
        "Jinan": "济南", "Qingdao": "青岛", "Dalian": "大连",
        "Xiamen": "厦门", "Fuzhou": "福州", "Kunming": "昆明",
        "Hefei": "合肥", "Ningbo": "宁波", "Suzhou": "苏州",
        "Wuxi": "无锡", "Changzhou": "常州", "Guilin": "桂林",
        "Nanning": "南宁", "Haikou": "海口", "Sanya": "三亚",
        "Guiyang": "贵阳", "Lanzhou": "兰州", "Urumqi": "乌市",
        "Hohhot": "呼市", "Harbin": "哈市", "Changchun": "长春",
        "Shenyang": "沈阳", "Shijiazhuang": "石市", "Taiyuan": "太原",
        "Xuzhou": "徐州", "Yancheng": "盐城", "Taishan": "台山",
        "Nanchang": "南昌", "Foshan": "佛山", "Dongguan": "东莞",
        "Zhuhai": "珠海", "Zhongshan": "中山", "Huizhou": "惠州"
    };
    return map[en] || en;
}

function formatMs(ms) {
    if (ms >= 10000) {
        return Math.floor(ms) + "ms";
    } else if (ms >= 1000) {
        return Math.floor(ms).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "ms";
    } else if (ms >= 100) {
        return ms.toFixed(1) + "ms";
    } else if (ms >= 10) {
        return ms.toFixed(2) + "ms";
    } else if (ms <= 0) {
        return "0.00ms";
    } else {
        return ms.toFixed(3) + "ms";
    }
}

function getFlag(cc) {
    if (!cc || cc.length !== 2) return "🌍";
    const cp = cc.toUpperCase().split('').map(function (c) { return 127397 + c.charCodeAt(); });
    return String.fromCodePoint.apply(null, cp);
}

/* ---------- 报告与结论（判定逻辑同原版 render） ---------- */

function buildReport(name, node, direct, remote, gpData) {
    const nOk = node && node.ok;
    const dOk = direct && direct.ok;
    const rOk = remote && remote.ok;

    const lines = [];

    let nodeStr = "节点代理: " + (nOk ? "✅ 正常" : "❌ 不可达");
    if (nOk && node.data) {
        const d = node.data;
        nodeStr += "\n出口 IP: " + d.query;
        nodeStr += "\n位置: " + [d.country, d.regionName, d.city].filter(Boolean).join(" - ");
        nodeStr += "\nISP: " + (d.isp || "未知");
    }
    lines.push(nodeStr);

    lines.push("本机网络: " + (dOk ? "✅ 正常" : "❌ 异常"));

    let remoteStr = "远端探测: " + (rOk ? "✅ 可达" : "❌ 不可达");
    if (remote && remote.data && remote.data.length > 0) {
        remoteStr += "\n" + remote.data.map(function (i) { return i.flag + " " + i.ms; }).join("  ");
    } else if (remote && remote.error) {
        remoteStr += "（" + remote.error + "）";
    }
    lines.push(remoteStr);

    let gpConclusion = null;
    if (gpData && gpData.results) {
        const analysis = analyzeBlockSource(gpData);
        if (analysis) {
            gpConclusion = analysis.conclusion;
            const ispOrder = ["中国电信", "中国联通", "中国移动"];
            const ispAbbr = { "中国电信": "电信", "中国联通": "联通", "中国移动": "移动" };
            const allProbes = [];
            for (let j = 0; j < ispOrder.length; j++) {
                const group = analysis.ispGroups[ispOrder[j]];
                if (!group) continue;
                for (let p = 0; p < group.probes.length; p++) {
                    allProbes.push(ispAbbr[ispOrder[j]] + "·" + group.probes[p].city + " " + group.probes[p].ms + (group.probes[p].ok ? "" : " ✗"));
                }
            }
            const domesticReachable = allProbes.length > 0 && ispOrder.some(function (k) {
                return analysis.ispGroups[k] && analysis.ispGroups[k].reachable;
            });
            let gpStr = "国内探测: " + (domesticReachable ? "✅ 可达" : "❌ 不可达");
            if (allProbes.length > 0) gpStr += "\n" + allProbes.join("  ");
            lines.push(gpStr);
        }
    }

    let conclusion;
    if (!dOk) {
        conclusion = "⚠️ 本机网络异常";
    } else if (nOk && rOk) {
        conclusion = "✅ 节点正常";
    } else if (!nOk && rOk && dOk) {
        conclusion = gpConclusion || "🚫 疑似被运营商/GFW 阻断";
    } else if (!nOk && !rOk && dOk) {
        conclusion = "💤 节点离线";
    } else {
        conclusion = "❓ 数据不完整";
    }

    return { conclusion: conclusion, lines: lines, nodeName: name };
}

/* ---------- 主入口（Egern generic，手动触发） ---------- */

export default async function (ctx) {

    const env = ctx.env || {};
    const policy = (env.POLICY || "").trim();
    const host = (env.HOST || "").trim();
    const port = (env.PORT || "").toString().trim();
    const name = (env.NAME || "").trim() || policy || "当前节点";

    if (!policy || !host || !port) {
        await ctx.notify({
            title: "🌐 节点阻断检测",
            body: "还没配置要测的节点：请在 Egern 的模块 Env 区填写 POLICY（节点名）、HOST（服务器地址）、PORT（端口）后重新运行本脚本。"
        });
        return;
    }

    try {

        const results = await Promise.all([
            checkViaNode(ctx, policy),
            checkDirect(ctx),
            checkRemote(ctx, host, port)
        ]);
        const node = results[0];
        const direct = results[1];
        const remote = results[2];

        // 与原版一致：直连正常 + 海外可达 + 经节点不通，才追加国内三网定位
        let gpData = null;
        if (direct.ok && remote.ok && !node.ok) {
            gpData = await fetchGlobalping(ctx, host, port);
        }

        const report = buildReport(name, node, direct, remote, gpData);

        const body = report.conclusion + "\n" + report.lines.join("\n") + "\n节点: " + report.nodeName;
        console.log("[BLOCK-CHECK]\n" + body);
        await ctx.notify({ title: "🌐 节点阻断检测", body: body });

    } catch (error) {

        console.log("[BLOCK-CHECK] ERROR = " + error);
        await ctx.notify({ title: "🌐 节点阻断检测", body: "检测出错：" + error });

    }
}
