// ==UserScript==
// @name         ARM Store 简体中文翻译 + 去广告
// @name:zh-CN   ARM Store 简体中文翻译 + 去广告
// @name:en      ARM Store Simplified Chinese Translator + Ad Remover
// @namespace    armconverter-store-zh-cn
// @version      2.0.0
// @downloadURL  https://raw.githubusercontent.com/idodo777/Me/main/ARMstore/armconverter-store-zh-CN.user.js
// @updateURL    https://raw.githubusercontent.com/idodo777/Me/main/ARMstore/armconverter-store-zh-CN.user.js
// @description  将 armconverter.com 的 ARM Store 界面翻译为简体中文，并屏蔽广告元素（广告位、广告 iframe、弹窗广告等）。
// @description:zh-CN 将 armconverter.com 的 ARM Store 界面翻译为简体中文，并屏蔽广告元素（广告位、广告 iframe、弹窗广告等）。
// @description:en Translate the ARM Store interface on armconverter.com into Simplified Chinese and block ad elements.
// @match        https://armconverter.com/store/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    /* ------------------------------------------------------------------
     * 目标：
     *   1. 让 ARM Store 页面直接以简体中文呈现；
     *   2. 屏蔽页面中的广告元素。
     *
     * 实现方式（两层通用引擎，不按页面逐条收录）：
     *   - 精准层：字符串映射（整串精确匹配）+ 安全片段替换 +
     *     前缀/正则规则，覆盖按钮、标题、标签等界面词，离线即时生效。
     *   - 通杀层：精准层没命中的英文句子，一律走在线机翻
     *     （Google 翻译接口优先，失败退到 MyMemory），译文缓存进
     *     localStorage；新页面、新文案无需再逐条收录。
     *     机翻只动多词英文句子，应用名/包名/数字/链接不动；
     *     接口不通时静默保留英文，不破坏页面。
     *   - MutationObserver 监听动态内容 + 属性（placeholder/title 等）翻译。
     *     商店内容需登录后才渲染，全部是动态写入 DOM 的，
     *     因此不能只在加载时替换一次，必须持续监听。
     *   - 去广告：三层防御——
     *     (a) document-start 注入 CSS，隐藏已知广告位/广告网络元素；
     *     (b) MutationObserver 移除动态插入的广告节点（广告 iframe、
     *         ins.adsbygoogle、广告域名脚本等）；
     *     (c) 拦截指向广告域名的 window.open 弹窗。
     *     选择器只用「词元级」匹配（class/id 以 ad/ads/sponsor 等为
     *     独立词元），不用 [class*="ad"] 这类子串匹配——否则会误伤
     *     本站的 Login Badge（badge 含 "ad" 子串）、download、
     *     header、loading 等正常元素。
     *
     * 说明：点击 Sign In 会跳转到 iosgods.com 的 OAuth 登录页，
     * 不在本脚本 @match 范围内，那一页不会被翻译。
     * ---------------------------------------------------------------- */

    // ========== 英文 → 简体中文 映射表 ==========
    // 整串精确匹配：文本节点 trim 后与左边完全相等才替换，
    // 因此应用名称、包名等动态内容不会被误伤；多写词条无副作用。
    const DICT = [
        // ---- 品牌 / 标题 / 顶栏（实地核对） ----
        ['ARM Store', 'ARM 商店'],
        ['ARM Converter', 'ARM 转换器'],
        ['Login', '登录'],
        ['Sign In', '登录'],
        ['Log In', '登录'],
        ['Logout', '退出登录'],
        ['Log Out', '退出登录'],
        ['Sign Out', '退出登录'],
        ['Home', '首页'],
        ['Loading...', '加载中…'],
        ['Loading', '加载中'],

        // ---- 左侧菜单（实地核对） ----
        ['ARM ↔ Hex Converter', 'ARM ↔ Hex 转换器'],
        ['Convert ARM64 assembly to Hex and vice versa', 'ARM64 汇编与 Hex 互转'],
        ['iTunes App Info', 'iTunes 应用信息'],
        ['App Info', '应用信息'],
        ['Get details of any app on the App Store', '查询 App Store 中任意应用的详情'],
        ['UDID Retriever', 'UDID 查询工具'],
        ['Retrieve UDID and other device details using UDID Retriever for Windows, macOS, and Android',
            '通过 UDID 查询工具获取 UDID 及其他设备详情，支持 Windows、macOS 和 Android'],
        ['Hex Calculator', 'Hex 计算器'],
        ['Convert Hex to Decimal and vice versa', 'Hex 与十进制互转'],

        // ---- 登录门禁 / 账户（实地核对） ----
        ['Login required', '需要登录'],
        ['Please log in!', '请先登录！'],
        ['Please log in', '请先登录'],
        ['Anonymous', '匿名用户'],
        ['Free', '免费'],
        ['Report an app · DMCA takedown', '举报应用 · DMCA 下架请求'],
        ['Report an app', '举报应用'],
        ['DMCA takedown', 'DMCA 下架请求'],

        // ---- 应用详情（实地核对） ----
        ['Additional Details', '其他详情'],
        ['Name:', '名称：'],
        ['Description:', '描述：'],
        ['Price:', '价格：'],
        ['Price', '价格'],
        ['0 USD', '0 美元'],

        // ---- 搜索 / 浏览（商店通用界面词） ----
        ['Search', '搜索'],
        ['Search apps', '搜索应用'],
        ['Search apps...', '搜索应用…'],
        ['Search iOS apps...', '搜索 iOS 应用…'],
        ['App Name', '应用名称'],
        ['Bundle ID', '应用包名'],
        ['Featured', '精选'],
        ['Top Charts', '排行榜'],
        ['Categories', '分类'],
        ['Category', '分类'],
        ['All', '全部'],
        ['Apps', '应用'],
        ['Games', '游戏'],
        ['Sort by', '排序方式'],
        ['Filter', '筛选'],
        ['Results', '结果'],
        ['No results found', '未找到结果'],
        ['No apps found', '未找到应用'],
        ['Recently Added', '最近添加'],
        ['Recently Updated', '最近更新'],
        ['Most Downloaded', '下载最多'],
        ['New', '最新'],
        ['Popular', '热门'],

        // ---- 应用卡片 / 详情（商店通用界面词） ----
        ['Download', '下载'],
        ['Downloads', '下载次数'],
        ['Download IPA', '下载 IPA'],
        ['Install', '安装'],
        ['Version', '版本'],
        ['Versions', '版本'],
        ['Latest', '最新'],
        ['Latest Version', '最新版本'],
        ['Older Versions', '历史版本'],
        ['Old Versions', '历史版本'],
        ['Size', '大小'],
        ['Developer', '开发者'],
        ['Seller', '销售商'],
        ['Updated', '更新时间'],
        ['Released', '发布时间'],
        ['Rating', '评分'],
        ['Reviews', '评价'],
        ['Screenshots', '截图'],
        ['Description', '描述'],
        ['Information', '信息'],
        ['Compatibility', '兼容性'],
        ['Languages', '语言'],
        ['Language', '语言'],
        ['Age Rating', '年龄分级'],
        ['Copyright', '版权'],
        ['Purchase', '购买'],
        ['Purchased', '已购买'],
        ['Buy', '购买'],
        ['Paid', '付费'],
        ['Get', '获取'],
        ['IPA', 'IPA'],
        ['Decrypt', '解密'],
        ['Decrypted', '已解密'],
        ['Request', '请求'],
        ['Requested', '已请求'],

        // ---- 通用按钮 / 状态（商店通用界面词） ----
        ['Back', '返回'],
        ['Next', '下一步'],
        ['Previous', '上一步'],
        ['Page', '页'],
        ['Cancel', '取消'],
        ['Confirm', '确认'],
        ['OK', '确定'],
        ['Close', '关闭'],
        ['Remove', '移除'],
        ['Delete', '删除'],
        ['Save', '保存'],
        ['Edit', '编辑'],
        ['Upload', '上传'],
        ['Share', '分享'],
        ['Copy Link', '复制链接'],
        ['Open', '打开'],
        ['View', '查看'],
        ['More', '更多'],
        ['Less', '收起'],
        ['Show more', '展开更多'],
        ['Show less', '收起'],
        ['See All', '查看全部'],
        ['See all', '查看全部'],
        ['Settings', '设置'],
        ['Account', '账户'],
        ['Profile', '个人资料'],
        ['My Apps', '我的应用'],
        ['History', '历史记录'],
        ['Credits', '点数'],
        ['Balance', '余额'],
        ['Processing', '处理中'],
        ['Pending', '等待中'],
        ['Completed', '已完成'],
        ['Failed', '失败'],
        ['Error', '错误'],
        ['Success', '成功'],
        ['Warning', '警告'],
        ['Unknown', '未知'],

        // ---- 截图反馈补充：列表标题 / 搜索区 / 国家选择 ----
        ['Recently Added Apps', '最近添加的应用'],
        ['Recently Updated Apps', '最近更新的应用'],
        ['Top Free Apps', '热门免费应用'],
        ['Top Paid Apps', '热门付费应用'],
        ['Search by app name, bundle ID, or app ID...', '按应用名、包名或应用 ID 搜索…'],
        ['Search by app name, bundle ID, or app ID…', '按应用名、包名或应用 ID 搜索…'],
        ['Country', '国家/地区'],
        ['Region', '地区'],
        ['Select Country', '选择国家/地区'],
        ['China', '中国'],
        ['United States', '美国'],
        ['United Kingdom', '英国'],
        ['Japan', '日本'],
        ['Vietnam', '越南'],
        ['South Korea', '韩国'],
        ['Korea', '韩国'],
        ['Taiwan', '台湾'],
        ['Hong Kong', '香港'],
        ['Singapore', '新加坡'],
        ['Canada', '加拿大'],
        ['Australia', '澳大利亚'],
        ['Germany', '德国'],
        ['France', '法国'],
        ['Russia', '俄罗斯'],
        ['India', '印度'],
        ['Brazil', '巴西'],
        ['Spain', '西班牙'],
        ['Italy', '意大利'],
        ['Netherlands', '荷兰'],
        ['Thailand', '泰国'],
        ['Indonesia', '印度尼西亚'],
        ['Malaysia', '马来西亚'],
        ['Philippines', '菲律宾'],
        ['Turkey', '土耳其'],
        ['Saudi Arabia', '沙特阿拉伯'],
        ['United Arab Emirates', '阿联酋'],
        ['Mexico', '墨西哥'],
        ['Argentina', '阿根廷'],
        ['Egypt', '埃及'],
        ['South Africa', '南非'],
        ['Israel', '以色列'],
        ['Pakistan', '巴基斯坦'],
        ['Ukraine', '乌克兰'],
        ['Poland', '波兰'],
        ['Sweden', '瑞典'],
        ['Norway', '挪威'],
        ['Denmark', '丹麦'],
        ['Finland', '芬兰'],
        ['Belgium', '比利时'],
        ['Switzerland', '瑞士'],
        ['Austria', '奥地利'],
        ['Greece', '希腊'],
        ['Portugal', '葡萄牙'],
        ['Ireland', '爱尔兰'],
        ['New Zealand', '新西兰'],

        // ---- 截图反馈补充：卡片安装按钮 / 详情标签 ----
        ['Install with Sideloadly', '使用 Sideloadly 安装'],
        ['Install with AltStore', '使用 AltStore 安装'],
        ['Install via iOSGods App+', '通过 iOSGods App+ 安装'],
        ['Decrypt this app', '解密此应用'],
        ['Decrypt This App', '解密此应用'],
        ['Version History', '版本历史'],
        ['All Versions', '全部版本'],
        ['Release Date', '发布日期'],
        ['Change', '更改'],
        ['Bundle ID:', '包名：'],
        ['Compatibility:', '兼容性：'],
        ['Size:', '大小：'],
        ['Version:', '版本：'],
        ['Developer:', '开发者：'],
        ['Category:', '分类：'],

        // ---- 截图反馈补充：下载 IPA 的悬浮说明（整段） ----
        ['Downloads the decrypted .ipa file straight to your device. Choose this if you already have a way to install IPAs yourself, such as Sideloadly, AltStore, or your own signing certificate/service.',
            '将解密后的 .ipa 文件直接下载到你的设备。如果你已有自行安装 IPA 的方式（如 Sideloadly、AltStore 或自己的签名证书/服务），请选择此项。'],

        // ---- 截图反馈补充：解密流程状态 / 错误提示（动态出现） ----
        ['Something went wrong :-(', '出了点问题 :-('],
        ['Something went wrong', '出了点问题'],
        ['Decrypting app', '正在解密应用'],
        ['Download options will appear here once it is ready.', '下载选项将在准备好后出现在这里。'],
        ['Waiting in queue', '排队等待中'],

        // ---- 截图反馈补充：版本历史弹窗 ----
        ['Additional versions are available for VIP members.', '更多版本仅向 VIP 会员开放。'],
        ['Additional versions are available for VIP members', '更多版本仅向 VIP 会员开放'],
        ['Upgrade to VIP', '升级 VIP'],
        ['for full version history access.', '以查看完整版本历史。'],
        ['(current)', '（当前版本）'],
        ['Current', '当前版本'],

        // ---- 截图反馈补充：详情页标题 / 区块标题 ----
        ['View in App Store', '在 App Store 中查看'],
        ['Disclaimer', '免责声明'],
        ['Download Options', '下载选项'],
        ['Report this app · DMCA', '举报此应用 · DMCA'],
        ['App Description', '应用描述'],
        ['App Information', '应用信息'],
        ['How to Install with Sideloadly', '如何使用 Sideloadly 安装'],
        ['About the file size:', '关于文件大小：'],
        ['for your computer', '电脑版'],
        ['Developer Mode', '开发者模式'],
    ];

    const EXACT = new Map(DICT);

    // 大小写不敏感查表：仅收录多词短语（如 INSTALL WITH SIDELOADLY 这类
    // 被 CSS text-transform 或原文写成全大写的按钮），避免单个词误伤应用名。
    const EXACT_CI = new Map();
    for (const [en, zh] of DICT) {
        if (en.includes(' ')) EXACT_CI.set(en.toLowerCase(), zh);
    }

    // 片段替换：只放不会与应用名/包名冲突的安全片段，长片段在前。
    const FRAGMENTS = [
        ['ARM Store', 'ARM 商店'],
        ['Downloads the decrypted .ipa file straight to your device.', '将解密后的 .ipa 文件直接下载到你的设备。'],
        ['Choose this if you already have a way to install IPAs yourself, such as Sideloadly, AltStore, or your own signing certificate/service.', '如果你已有自行安装 IPA 的方式（如 Sideloadly、AltStore 或自己的签名证书/服务），请选择此项。'],
        ['Report an app · DMCA takedown', '举报应用 · DMCA 下架请求'],
        [' downloads', ' 次下载'],
        [' results', ' 条结果'],
        [' USD', ' 美元'],
    ];

    // 前缀型动态文案（如 "Version 1.2.3"、"Looking up com.example"）
    const PREFIXES = [
        ['Looking up ', '正在查询 '],
        ['Searching for ', '正在搜索 '],
        ['Downloading ', '正在下载 '],
        ['Version ', '版本 '],
        ['Updated on ', '更新于 '],
    ];

    // 正则型动态文案：数字/应用名会变的句子，用捕获组拼中文。
    const REGEXES = [
        // "Approx. wait time: 7 seconds" / "Approx. wait time: 1 second"
        [/^Approx\. wait time:\s*(\d+)\s*seconds?$/, (m) => '预计等待时间：' + m[1] + ' 秒'],
        // "Version History for 红果短剧 - …"（弹窗标题，应用名动态）
        [/^Version History for\s+(.+)$/, (m) => m[1] + ' 的版本历史'],
        // "(9,424,366 ratings)"（评分人数动态）
        [/^\(([\d,]+)\s*ratings?\)$/, (m) => '（' + m[1] + ' 个评分）'],
    ];

    // ---------- 词条查表 ----------
    function translate(text) {
        if (!text) return text;
        const raw = text;
        const trimmed = raw.trim();
        if (!trimmed) return raw;

        // 1) 整串精确匹配（保留首尾空白）
        if (EXACT.has(trimmed)) {
            const i = raw.indexOf(trimmed);
            return raw.slice(0, i) + EXACT.get(trimmed) + raw.slice(i + trimmed.length);
        }

        // 1.2) 结尾冒号的标签（如 "Bundle ID:"、"Compatibility:"、"Size:"）：
        //      冒号前的词在词典中时，标签译为中文并换成全角冒号。
        const cm = trimmed.match(/^(.+?):$/);
        if (cm && EXACT.has(cm[1].trim())) {
            const i = raw.indexOf(trimmed);
            return raw.slice(0, i) + EXACT.get(cm[1].trim()) + '：' + raw.slice(i + trimmed.length);
        }

        // 1.3) 多词短语大小写不敏感匹配（全大写按钮等）
        if (trimmed.includes(' ') && EXACT_CI.has(trimmed.toLowerCase())) {
            const i = raw.indexOf(trimmed);
            return raw.slice(0, i) + EXACT_CI.get(trimmed.toLowerCase()) + raw.slice(i + trimmed.length);
        }

        // 1.4) 作者行 "by <开发者>"（版本号可有可无）→ "作者：<开发者>"
        //      排除以 by 开头的普通句子（如 by downloading…），只认名字。
        const bm = trimmed.match(/^by\s+(.+?)(?:\s+(v[\d][\d.]*))?$/i);
        if (bm && !/\b(you|this|that|downloading|installing|clicking|using|agree)\b/i.test(bm[1])) {
            const i = raw.indexOf(trimmed);
            return raw.slice(0, i) + '作者：' + bm[1] + (bm[2] ? ' ' + bm[2] : '') + raw.slice(i + trimmed.length);
        }

        // 1.5) 前置 emoji / 符号：拆出前缀符号，只翻译其后的实体文本
        const m = trimmed.match(/^([\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]+\s*)(.+)$/u);
        if (m && EXACT.has(m[2].trim())) {
            const rest = m[2].trim();
            return raw.replace(rest, EXACT.get(rest));
        }

        // 1.6) 正则型动态文案（保留首尾空白）
        for (const [re, fn] of REGEXES) {
            const rm = trimmed.match(re);
            if (rm) {
                const i = raw.indexOf(trimmed);
                return raw.slice(0, i) + fn(rm) + raw.slice(i + trimmed.length);
            }
        }

        // 2) 前缀型
        for (const [en, zh] of PREFIXES) {
            if (trimmed.startsWith(en)) return raw.replace(en, zh);
        }

        // 3) 片段替换
        let out = raw;
        let changed = false;
        for (const [en, zh] of FRAGMENTS) {
            if (out.indexOf(en) !== -1) {
                out = out.split(en).join(zh);
                changed = true;
            }
        }
        return changed ? out : raw;
    }

    // ========== 机器翻译兜底（通杀层） ==========
    // 精准层没命中的英文句子走在线机翻：Google 翻译接口优先，
    // 失败退到 MyMemory；两路都失败时静默保留英文。
    // 译文缓存进 localStorage，重复打开页面不再重复请求。
    const MT_LS_KEY = 'armstore-mt-v1';
    const MT_CACHE = new Map();
    try {
        const saved = JSON.parse(localStorage.getItem(MT_LS_KEY) || '{}');
        for (const [k, v] of Object.entries(saved)) MT_CACHE.set(k, v);
    } catch (e) {}
    let mtSaveTimer = 0;
    function mtSaveCache() {
        clearTimeout(mtSaveTimer);
        mtSaveTimer = setTimeout(() => {
            try {
                while (MT_CACHE.size > 500) MT_CACHE.delete(MT_CACHE.keys().next().value);
                localStorage.setItem(MT_LS_KEY, JSON.stringify(Object.fromEntries(MT_CACHE)));
            } catch (e) {}
        }, 500);
    }

    const MT_QUEUED = new WeakSet();
    const MT_FAILED = new WeakSet();
    const MT_PENDING = new Map(); // 原文 -> Promise<译文>（同文去重）
    const MT_QUEUE = [];
    let mtActive = 0;
    const MT_CONCURRENCY = 3;
    const mtFails = { gtx: 0, mymemory: 0 };

    // 只机翻多词英文句子：标题元素里的应用名、包名、数字、链接、
    // 已含中文的一律不动；短标签留给精准层，避免误伤。
    function looksTranslatable(node, text) {
        const t = (text || '').trim();
        if (t.length < 12) return false;
        if (/[\u4e00-\u9fff]/.test(t)) return false;
        if (!/\s/.test(t)) return false;
        if (t.length < 30 && !/[.!?:;]$/.test(t)) return false;
        const letters = (t.match(/[A-Za-z]/g) || []).length;
        if (letters < 4 || letters / t.length < 0.5) return false;
        if (t.includes('://') || t.includes('@')) return false;
        try {
            const el = node.parentElement;
            if (el && el.closest('h1,h2,h3,h4,h5,h6')) return false; // 标题多为应用名
        } catch (e) {}
        return true;
    }

    async function fetchWithTimeout(url, ms) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), ms);
        try {
            return await fetch(url, { signal: ctrl.signal });
        } finally { clearTimeout(timer); }
    }

    async function fetchMTgtx(text) {
        const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=' + encodeURIComponent(text);
        const res = await fetchWithTimeout(url, 8000);
        if (!res.ok) throw new Error('gtx http ' + res.status);
        const data = await res.json();
        const out = ((data && data[0]) || []).map(seg => (seg && seg[0]) || '').join('');
        if (!out || out === text) throw new Error('gtx empty');
        return out;
    }

    async function fetchMTMyMemory(text) {
        const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=en|zh-CN';
        const res = await fetchWithTimeout(url, 8000);
        if (!res.ok) throw new Error('mm http ' + res.status);
        const data = await res.json();
        const out = data && data.responseData && data.responseData.translatedText;
        if (!out || out === text) throw new Error('mm empty');
        return out;
    }

    function fetchMT(text) {
        let p = MT_PENDING.get(text);
        if (p) return p;
        p = (async () => {
            if (mtFails.gtx < 3) {
                try {
                    const zh = await fetchMTgtx(text);
                    mtFails.gtx = 0;
                    return zh;
                } catch (e) { mtFails.gtx++; }
            }
            if (mtFails.mymemory < 3) {
                try {
                    const zh = await fetchMTMyMemory(text);
                    mtFails.mymemory = 0;
                    return zh;
                } catch (e) { mtFails.mymemory++; }
            }
            throw new Error('all mt endpoints dead');
        })();
        p.then(
            zh => { MT_CACHE.set(text, zh); MT_PENDING.delete(text); mtSaveCache(); },
            () => { MT_PENDING.delete(text); }
        );
        MT_PENDING.set(text, p);
        return p;
    }

    function queueMT(node) {
        if (MT_QUEUE.length > 200) return;
        if (MT_QUEUED.has(node) || MT_FAILED.has(node)) return;
        if (!looksTranslatable(node, node.nodeValue)) return;
        MT_QUEUED.add(node);
        MT_QUEUE.push(node);
        pumpMT();
    }

    function pumpMT() {
        while (mtActive < MT_CONCURRENCY && MT_QUEUE.length) {
            const node = MT_QUEUE.shift();
            mtActive++;
            translateNodeMT(node).finally(() => { mtActive--; pumpMT(); });
        }
    }

    async function translateNodeMT(node) {
        const raw = node.nodeValue;
        const trimmed = raw.trim();
        if (MT_CACHE.has(trimmed)) { applyMT(node, raw); return; }
        try {
            await fetchMT(trimmed);
            applyMT(node, raw);
        } catch (e) {
            MT_FAILED.add(node);
        }
    }

    function applyMT(node, raw) {
        if (!node.isConnected) return;
        if (node.nodeValue !== raw) return; // 排队期间已被改过（如精准层已翻），不动
        const trimmed = raw.trim();
        const zh = MT_CACHE.get(trimmed);
        if (!zh || zh === trimmed) return;
        const i = raw.indexOf(trimmed);
        node.nodeValue = raw.slice(0, i) + zh + raw.slice(i + trimmed.length);
    }

    // ---------- 翻译：文本节点与属性 ----------
    function skipNode(node) {
        const p = node.parentNode;
        if (!p || !p.tagName) return false;
        const tag = p.tagName.toUpperCase();
        return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE' || tag === 'PRE';
    }

    function translateTextNode(node) {
        if (skipNode(node)) return;
        const data = node.nodeValue;
        if (!data) return;
        const next = translate(data);
        if (next !== data) { node.nodeValue = next; return; }
        queueMT(node); // 精准层没命中，交给机翻兜底
    }

    const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'value'];

    function translateElementAttrs(el) {
        if (!el || el.nodeType !== 1 || !el.hasAttribute) return;
        for (const a of ATTRS) {
            if (!el.hasAttribute(a)) continue;
            const cur = el.getAttribute(a);
            const next = translate(cur);
            if (next !== cur) el.setAttribute(a, next);
        }
    }

    function walk(root) {
        if (!root) return;
        if (root.nodeType === 3) { translateTextNode(root); return; }
        if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
        if (root.nodeType === 1) translateElementAttrs(root);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
            acceptNode(n) {
                if (n.nodeType === 1) {
                    const t = n.tagName.toUpperCase();
                    if (t === 'SCRIPT' || t === 'STYLE' || t === 'CODE' || t === 'PRE') {
                        return NodeFilter.FILTER_REJECT;
                    }
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let n;
        while ((n = walker.nextNode())) {
            if (n.nodeType === 3) translateTextNode(n);
            else translateElementAttrs(n);
        }
    }

    // alert 提示也翻译
    const nativeAlert = window.alert;
    window.alert = function (msg) {
        return nativeAlert.call(window, translate(String(msg == null ? '' : msg)));
    };

    // ========== 去广告 ==========

    // 已知广告网络域名：iframe / script / img / a 指向这些域名即视为广告。
    const AD_DOMAINS = [
        'googlesyndication.com', 'doubleclick.net', 'googleadservices.com',
        'adservice.google.com', 'amazon-adsystem.com', 'ads.yahoo.com',
        'popads.net', 'popcash.net', 'propellerads.com', 'adsterra.com',
        'exoclick.com', 'trafficjunky.com', 'juicyads.com', 'hilltopads.com',
        'clickadu.com', 'adcash.com', 'admaven.com', 'mondiad.com',
        'push.house', 'onclickperformance.com', 'topcreativeformat.com',
        'highperformanceformat.com', 'invoke.js',
    ];

    // 直接移除的元素（广告网络专用标记，误伤概率极低）。
    const AD_REMOVE_SELECTORS = [
        'ins.adsbygoogle',
        'iframe[src*="googlesyndication"]',
        'iframe[src*="doubleclick"]',
        'iframe[src*="googleadservices"]',
        'iframe[src*="adservice.google"]',
        '[id^="google_ads"]',
        '[id^="div-gpt-ad"]',
        '[data-ad-slot]',
        '[data-ad-client]',
        '[data-adsbygoogle-status]',
    ].join(',');

    // 仅隐藏（不移除）的广告位：词元级选择器，避免子串误伤正常元素。
    const AD_HIDE_CSS = `
        ins.adsbygoogle, .adsbygoogle,
        [id^="google_ads_"], [id^="div-gpt-ad"], .gpt-ad,
        [data-ad-slot], [data-ad-client],
        [class~="ad"], [class~="ads"], [class~="advertisement"],
        [class^="ad-"], [class$="-ad"], [class*="-ad-"],
        [class^="ads-"], [class$="-ads"], [class*="-ads-"],
        [id^="ad-"], [id$="-ad"], [id*="-ad-"],
        [id^="ads-"], [id$="-ads"],
        [class*="ad-banner"], [class*="banner-ad"],
        [class*="ads-banner"], [class*="sponsored"],
        [id*="sponsor"], [class*="sticky-ad"], [class*="floating-ad"],
        [class*="popup-ad"], [class*="ad-popup"],
        iframe[src*="googlesyndication"], iframe[src*="doubleclick"],
        iframe[src*="googleadservices"], iframe[src*="adservice."],
        iframe[src*="popads"], iframe[src*="propeller"],
        iframe[src*="adsterra"], iframe[src*="exoclick"],
        iframe[src*="trafficjunky"], iframe[src*="juicyads"],
        iframe[src*="hilltopads"], iframe[src*="clickadu"]
        { display: none !important; visibility: hidden !important; }`;

    const STYLE_ID = 'tm-armstore-zh-adblock';

    function injectAdblockStyle() {
        const host = document.head || document.documentElement;
        if (!host) return;
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = AD_HIDE_CSS;
        host.appendChild(style);
    }

    function hostOf(url) {
        try { return new URL(url, location.href).hostname; } catch (e) { return ''; }
    }

    function isAdUrl(url) {
        if (!url) return false;
        const h = hostOf(url);
        return AD_DOMAINS.some(d => h === d || h.endsWith('.' + d) || String(url).includes(d));
    }

    // 判断一个新增节点是否广告节点（只处理高置信度情形，其余交给 CSS 隐藏）。
    function isAdNode(node) {
        if (!node || node.nodeType !== 1) return false;
        const tag = node.tagName.toUpperCase();
        if (tag === 'IFRAME' || tag === 'SCRIPT' || tag === 'IMG') {
            return isAdUrl(node.getAttribute('src') || '');
        }
        if (tag === 'INS') {
            return (node.className || '').toString().includes('adsbygoogle');
        }
        try {
            return node.matches(AD_REMOVE_SELECTORS);
        } catch (e) {
            return false;
        }
    }

    function sweepAds(root) {
        if (!root || root.nodeType !== 1) return;
        if (isAdNode(root)) { root.remove(); return; }
        if (!root.querySelectorAll) return;
        root.querySelectorAll(AD_REMOVE_SELECTORS).forEach(el => el.remove());
        root.querySelectorAll('iframe[src], script[src], img[src]').forEach(el => {
            if (isAdUrl(el.getAttribute('src') || '')) el.remove();
        });
    }

    // 拦截指向广告域名的弹窗（popunder 常见手法）；正常站内/登录跳转不受影响。
    const nativeOpen = window.open;
    window.open = function (url, ...rest) {
        if (url && isAdUrl(String(url))) return null;
        return nativeOpen.call(window, url, ...rest);
    };

    // ---------- MutationObserver：翻译 + 去广告 ----------
    function handleAdded(node) {
        if (node.nodeType === 3) { translateTextNode(node); return; }
        if (node.nodeType !== 1) return;
        if (isAdNode(node)) { node.remove(); return; }
        walk(node);
        sweepAds(node);
    }

    function startObserver() {
        const obs = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type === 'characterData') {
                    translateTextNode(m.target);
                    continue;
                }
                for (const node of m.addedNodes) handleAdded(node);
                if (m.type === 'attributes' && m.target && m.target.nodeType === 1) {
                    translateElementAttrs(m.target);
                }
            }
        });
        obs.observe(document.documentElement || document, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ATTRS,
        });
        return obs;
    }

    // ---------- 启动 ----------
    function boot() {
        injectAdblockStyle();
        walk(document.documentElement || document);
        sweepAds(document.documentElement);
        startObserver();
        try { document.documentElement.lang = 'zh-CN'; } catch (e) {}

        // 站点登录后会多次重绘，补几次全量扫描兜底（有界，不常驻）
        let ticks = 0;
        const t = setInterval(() => {
            injectAdblockStyle();
            walk(document.documentElement || document);
            sweepAds(document.documentElement);
            if (++ticks >= 20) clearInterval(t);
        }, 150);
    }

    // document-start 时 documentElement 已存在；head 可能还没有，
    // injectAdblockStyle 会先挂到 documentElement，DOMContentLoaded 后再补挂一次。
    if (document.documentElement) boot();
    else document.addEventListener('DOMContentLoaded', boot, { once: true });

    document.addEventListener('DOMContentLoaded', injectAdblockStyle);
    window.addEventListener('load', () => {
        injectAdblockStyle();
        walk(document.documentElement || document);
        sweepAds(document.documentElement);
    });
})();
