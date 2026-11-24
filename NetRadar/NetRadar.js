// 上游作者：jnlaoshu
// 上游更新时间：2026.08.17 09:00
// 拦截数量：0
// 脚本数量：1
// 上游来源：https://raw.githubusercontent.com/jnlaoshu/MySelf/master/Egern/Widget/NetRadar.js
// 本地修改（2026-11-24）：只保留大号布局，删除中号/小号相关代码；深色/浅色双模式保留；本地延迟与节点延迟改为各测 3 次取中位数；地名繁体转简体；解锁地区按节点实际国家显示（上游写死 HK/SG/US）

function clean(value) {
  return String(
    value === undefined || value === null ? "" : value
  ).trim();
}

function median(values) {
  const sorted = (values || []).filter(function (v) {
    return Number.isFinite(v) && v > 0;
  }).sort(function (a, b) {
    return a - b;
  });

  if (sorted.length === 0) return 0;

  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

const PLACE_NAME_FIX = {
  "聖荷西": "圣何塞",
  "圣荷西": "圣何塞",
  "San Jose": "圣何塞",
  "聖塔克拉拉": "圣塔克拉拉",
  "聖地牙哥": "圣地亚哥",
  "圣地牙哥": "圣地亚哥",
  "洛杉磯": "洛杉矶",
  "舊金山": "旧金山",
  "紐約": "纽约",
  "西雅圖": "西雅图",
  "休斯頓": "休斯顿",
  "達拉斯": "达拉斯",
  "亞特蘭大": "亚特兰大",
  "邁阿密": "迈阿密",
  "波士頓": "波士顿",
  "費城": "费城",
  "鳳凰城": "凤凰城",
  "拉斯維加斯": "拉斯维加斯",
  "華盛頓": "华盛顿",
  "加利福尼亞州": "加利福尼亚州",
  "德克薩斯州": "德克萨斯州",
  "佛羅里達州": "佛罗里达州",
  "紐約州": "纽约州",
  "華盛頓州": "华盛顿州",
  "美國": "美国",
  "中國": "中国"
};

const TRAD_TO_SIMP = {
  "聖": "圣", "亞": "亚", "臺": "台", "灣": "湾", "區": "区",
  "縣": "县", "兒": "儿", "奧": "奥", "韋": "韦", "爾": "尔",
  "蘭": "兰", "羅": "罗", "馬": "马", "剋": "克", "漢": "汉",
  "內": "内", "達": "达", "頓": "顿", "紐": "纽", "約": "约",
  "圖": "图", "費": "费", "鳳": "凤", "維": "维", "麥": "麦",
  "薩": "萨", "門": "门", "託": "托", "倫": "伦", "愛": "爱",
  "華": "华", "舊": "旧", "裡": "里", "麼": "么"
};

function normalizePlaceName(value) {
  let text = clean(value);

  if (!text) return text;
  if (PLACE_NAME_FIX[text]) return PLACE_NAME_FIX[text];

  let out = "";

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    out += TRAD_TO_SIMP[ch] || ch;
  }

  return PLACE_NAME_FIX[out] || out;
}

export default async function (ctx) {
  const TIMEOUT_MS = 3000;
  const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache'
  };

  const getFlagEmoji = (cc) => {
    if (!cc || cc === 'XX' || cc === '--' || cc === 'CN') return '🇨🇳';
    return cc.toUpperCase().replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
  };

  const fmtISP = (isp) => {
    if (!isp) return "";
    const s = String(isp).toLowerCase();
    if (s.includes('--') || s === '未知' || s === 'unknown') return "";
    const raw = String(isp).replace(/\s*[\(\（]中国[\)\）]\s*/, "").replace(/\s+/g, " ").trim();
    if (/(^|[\s-])(cmcc|cmnet|cmi|mobile)\b|移动/.test(s)) return "中国移动";
    if (/(^|[\s-])(chinanet|telecom|ctcc|ct)\b|电信/.test(s))  return "中国电信";
    if (/(^|[\s-])(unicom|cncgroup|netcom|link)\b|联通/.test(s)) return "中国联通";
    if (/(^|[\s-])(cbn|broadcast)\b|广电/.test(s))             return "中国广电";
    return raw;
  };

  const parseProxyMode = (context) => {
    let mode = "Rule";
    try {
      if (!context) return mode;
      const p = context.proxy || context.node || context.policy || context.outbound || context.egern;
      if (typeof p === 'string') return p;
      if (p && typeof p === 'object') return p.name || p.title || p.remark || p.policy || "Rule";
    } catch (e) {}
    return mode;
  };

  const now = new Date();
  const timeStr = `${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const C = {
    bg: { light: '#F9F9FB', dark: '#0A0C10' },
    cardBg: { light: '#FFFFFF', dark: '#12151D' },
    cardBorder: { light: '#E8E8ED', dark: '#1F2430' },
    textMain: { light: '#111111', dark: '#FFFFFF' },
    textSub: { light: '#7C7C80', dark: '#8B949E' },
    blue: { light: '#0066FF', dark: '#58A6FF' },
    green: { light: '#248A3D', dark: '#3FB950' },
    purple: { light: '#8C32E6', dark: '#BC8CFF' },
    red: { light: '#E3241B', dark: '#F85149' },
    warn: { light: '#E87D00', dark: '#F5A623' },
    badgeBg: { light: '#F0F0F4', dark: '#1C212B' },
    greenBadge: { light: '#E8F5E9', dark: '#1A3320' }
  };

  const isDarkMode = ctx.device?.isDarkMode || false;

  const httpGet = async (url) => {
    const start = Date.now();
    try {
      const resp = await ctx.http.get(url, { headers: commonHeaders, timeout: TIMEOUT_MS });
      const text = await resp.text();
      const json = JSON.parse(text);
      return { data: json.data || json, ping: Date.now() - start };
    } catch (e) { return { data: {}, ping: 0 }; }
  };

  // 本地延迟与节点延迟各测 3 次取中位数，丢包尖刺不会一次拉高数值
  const httpGetMedian = async (url) => {
    const tries = await Promise.all([httpGet(url), httpGet(url), httpGet(url)]);
    const ok = tries.filter(function (t) {
      return t.ping > 0 && t.data && Object.keys(t.data).length > 0;
    });
    const pings = ok.map(function (t) { return t.ping; });
    return {
      data: (ok[0] && ok[0].data) || {},
      ping: median(pings)
    };
  };

  async function timed(fn, timeoutMs = TIMEOUT_MS) {
    const start = Date.now();
    try {
      const result = await Promise.race([ fn(), new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs)) ]);
      return { ...result, ms: Date.now() - start };
    } catch { return { code: 'ERR', ms: 0 }; }
  }

  async function checkYouTube() { const res = await ctx.http.get(`https://www.youtube.com/generate_204`, { timeout: TIMEOUT_MS, headers: commonHeaders }).catch(() => null); return { code: res?.status === 204 ? 'OK' : 'ERR' }; }
  async function checkNetflix() { const res = await ctx.http.get(`https://www.netflix.com/generate_204`, { timeout: TIMEOUT_MS, headers: commonHeaders, followRedirect: false }).catch(() => null); return { code: (res?.status === 204 || res?.status === 200) ? 'OK' : 'ERR' }; }
  async function checkDisney() { const res = await ctx.http.get(`https://www.disneyplus.com/`, { timeout: 4500, headers: commonHeaders, followRedirect: false }).catch(() => null); return { code: (res && res.status !== 403) ? 'OK' : 'ERR' }; }
  async function checkSpotify() { const res = await ctx.http.get(`https://open.spotify.com/`, { timeout: TIMEOUT_MS, headers: commonHeaders, followRedirect: false }).catch(() => null); return { code: res && res.status === 200 ? 'OK' : 'ERR' }; }
  async function checkChatGPT() { const res = await ctx.http.get(`https://chatgpt.com/`, { timeout: 4500, headers: commonHeaders, followRedirect: false }).catch(() => null); return { code: (res && (res.status === 200 || res.status === 302 || res.status === 401 || res.status === 404)) ? 'OK' : 'ERR' }; }
  async function checkClaude() { const res = await ctx.http.get(`https://api.anthropic.com/`, { timeout: 4500, headers: commonHeaders, followRedirect: false }).catch(() => null); return { code: (res && (res.status === 404 || res.status === 401 || res.status === 200)) ? 'OK' : 'ERR' }; }
  async function checkGemini() {
    const startTime = Date.now();
    try {
      // 探测无 Geo-IP 强前端拦截的底层 API 模型接口
      const res = await ctx.http.get("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        timeout: 4500
      });
      // 只要 API 有响应（包含 403），即代表链路畅通且节点解锁成功
      const delay = Date.now() - startTime;
      return { status: 'OK', delay: `${delay}ms` };
    } catch (e) {
      return { status: 'ERR', delay: '--' };
    }
  }
  async function checkGrok() { const res = await ctx.http.get(`https://grok.com/`, { timeout: TIMEOUT_MS, headers: commonHeaders, followRedirect: false }).catch(() => null); return { code: res && res.status === 200 ? 'OK' : 'ERR' }; }

  const d = ctx.device || {};
  const localIP = d.ipv4?.address || "127.0.0.1";
  const gatewayIP = d.ipv4?.gateway || "192.168.1.1";
  const wifiSsid = d.wifi?.ssid;
  const cellularRadio = d.cellular?.radio;
  const hasLocalIPv6 = !!d.ipv6?.address;
  const currentPolicy = parseProxyMode(ctx);

  const [
    localInfo, nodeInfo, pureInfo, ipv6Resp,
    youtube, netflix, disney, spotify, chatgpt, claude, gemini, grok
  ] = await Promise.all([
    httpGetMedian('https://myip.ipip.net/json'),
    httpGetMedian(`http://ip-api.com/json/?lang=zh-CN&_t=${Date.now()}`),
    httpGet('https://my.ippure.com/v1/info'),
    httpGet('https://api64.ipify.org?format=json'),
    timed(checkYouTube, TIMEOUT_MS), timed(checkNetflix, TIMEOUT_MS), timed(checkDisney, 4500), timed(checkSpotify, TIMEOUT_MS),
    timed(checkChatGPT, 4500), timed(checkClaude, 4500), timed(checkGemini, 4500), timed(checkGrok, TIMEOUT_MS)
  ]);

  const local = localInfo.data || {};
  const node = nodeInfo.data || {};

  const proxyIP = node.query || "未知 IP";
  const cc = (node.countryCode || "US").toUpperCase();
  const nodeIsp = node.isp || node.org || "未知ISP";

  const riskScore = pureInfo.data?.fraudScore || 0;
  const pureScore = 100 - riskScore;
  const resolveThemeColor = (colorObj) => isDarkMode ? colorObj.dark : colorObj.light;
  const activePureColorHex = pureScore >= 80 ? resolveThemeColor(C.green) : (pureScore >= 50 ? resolveThemeColor(C.warn) : resolveThemeColor(C.red));

  const isResidential = pureInfo.data?.isResidential;
  const residentialColorHex = isResidential ? resolveThemeColor(C.green) : resolveThemeColor(C.red);
  const asnStr = node.as ? String(node.as).split(' ')[0] : "未知";
  const publicIPv6 = ipv6Resp.data?.ip?.includes(':') ? ipv6Resp.data.ip : '';
  const currentIpType = (hasLocalIPv6 || publicIPv6) ? 'v4 / v6' : 'IPv4';
  const locArr = Array.isArray(local.location) ? local.location : [];

  let sysCarrier = d.cellular?.carrier || "";
  if (sysCarrier && (sysCarrier.toLowerCase() === 'unknown' || sysCarrier.includes('--') || sysCarrier === '未知')) sysCarrier = "";

  let apiISP = (locArr.length > 0 ? locArr[locArr.length - 1] : "") || "";
  if (apiISP && (apiISP.toLowerCase() === 'unknown' || apiISP.includes('--') || apiISP === '未知')) apiISP = "";

  const rawISP = wifiSsid ? (apiISP || sysCarrier) : (sysCarrier || apiISP);
  const currentISP = fmtISP(rawISP);
  const ispPrefix = currentISP ? `${currentISP} · ` : "";

  let exactLocation = "未知";
  if (locArr.length > 0) {
    let prov = locArr[1] || ""; let city = locArr[2] || "";
    exactLocation = (prov || city) ? (prov === city ? prov : (prov + city)) : (locArr[0] || "中国");
  }
  exactLocation = normalizePlaceName(exactLocation);

  const rawRadio  = cellularRadio ? String(cellularRadio).toUpperCase().trim() : "";
  const radioType = { "GPRS": "2.5G", "EDGE": "2.75G", "WCDMA": "3G", "LTE": "4G", "NR": "5G", "NRNSA": "5G" }[rawRadio] || rawRadio;

  const netIconName = wifiSsid ? 'wifi.circle.fill' : (cellularRadio ? 'antenna.radiowaves.left.and.right' : 'wifi.slash');
  const netTitle = wifiSsid ? `${ispPrefix}${wifiSsid}` : (radioType ? `${ispPrefix}${radioType}` : "未连接");

  const POLICY_REGION = {
    'YouTube': 'HK', 'Netflix': 'SG', 'Disney+': 'SG', 'Spotify': 'US',
    'ChatGPT': 'US', 'Claude':  'US', 'Gemini':  'US', 'Grok':    'US'
  };

  const resultInfo = (result, name) => {
    const available = result.code === 'OK' || result.status === 'OK';
    // 解锁地区按节点实际国家显示，上游写死的表只作兜底
    const finalRegion = cc || POLICY_REGION[name] || 'XX';
    return { available, region: available ? finalRegion : '--', ms: result.ms || 0 };
  };

  const allServices = [
    { name: 'YouTube', info: resultInfo(youtube, 'YouTube') }, { name: 'Netflix', info: resultInfo(netflix, 'Netflix') },
    { name: 'Disney+', info: resultInfo(disney, 'Disney+') }, { name: 'Spotify', info: resultInfo(spotify, 'Spotify') },
    { name: 'ChatGPT', info: resultInfo(chatgpt, 'ChatGPT') }, { name: 'Claude',  info: resultInfo(claude, 'Claude') },
    { name: 'Gemini',  info: resultInfo(gemini, 'Gemini') }, { name: 'Grok',    info: resultInfo(grok, 'Grok') }
  ];

  const mkRow = (children, opts = {}) => ({ type: 'stack', direction: 'row', alignItems: 'center', ...opts, children });
  const mkCol = (children, opts = {}) => ({ type: 'stack', direction: 'column', ...opts, children });
  const mkText = (text, size, color, weight = 'regular', opts = {}) => ({ type: 'text', text: String(text), textColor: color, font: { size, weight }, ...opts });
  const mkIcon = (src, color, size = 14, opts = {}) => ({ type: 'image', src: `sf-symbol:${src}`, color, width: size, height: size, ...opts });
  const mkSpacer = (len) => len ? { type: 'spacer', length: len } : { type: 'spacer' };

  const responseColor = (ms, available) => !available ? C.red : (ms >= 1500 ? C.warn : C.textSub);

  const renderDataBlock = (icon, title, value, valColor = C.textMain) => {
    return mkCol([
      mkRow([ mkIcon(icon, C.textSub, 9), mkSpacer(4), mkText(title, 9, C.textSub, 'bold') ], { justifyContent: 'center' }),
      mkSpacer(5),
      mkText(value, 10, valColor, 'bold', { maxLines: 1, minScale: 0.3 })
    ], { alignItems: 'center', justifyContent: 'center', padding: [6, 4], backgroundColor: C.badgeBg, borderRadius: 6, flex: 1 });
  };

  const ServiceBlock = (item) => {
    const isOk = item.info.available;
    return mkCol([
      mkRow([
        mkText(item.name, 11, C.textMain, 'bold', { flex: 1, maxLines: 1 }),
        { type: 'stack', width: 5, height: 5, borderRadius: 2.5, backgroundColor: isOk ? C.green : C.red }
      ]),
      mkSpacer(8),
      mkRow([
        mkText(item.info.region, 9, C.textSub, 'regular'),
        mkSpacer(),
        mkText(isOk ? `${item.info.ms}ms` : '--', 9, responseColor(item.info.ms, isOk), 'regular', { design: 'monospaced' })
      ])
    ], { backgroundColor: C.cardBg, borderRadius: 8, padding: [8, 8], flex: 1, borderWidth: 1, borderColor: C.cardBorder });
  };

  const headerRow = mkRow([
    mkIcon('waveform.path.ecg', C.blue, 12), mkSpacer(6),
    mkText('网络雷达', 12, C.textMain, 'bold'),
    mkSpacer(),
    mkRow([ mkIcon('shield.fill', C.purple, 9), mkSpacer(4), mkText(currentPolicy, 9, C.textMain, 'bold', { maxLines: 1 }) ], { padding: [3, 8], backgroundColor: C.badgeBg, borderRadius: 6 }),
    mkSpacer(8),
    mkRow([ mkIcon('arrow.triangle.2.circlepath', C.textSub, 10), mkSpacer(3), mkText(timeStr, 10, C.textSub, 'bold', { family: 'Menlo' }) ])
  ]);

  const localBox = mkCol([
    mkRow([
      mkIcon(netIconName, C.blue, wifiSsid ? 26 : 22), mkSpacer(8),
      mkCol([
        mkText(netTitle, 13, C.textMain, 'bold', { maxLines: 1, minScale: 0.3 }), mkSpacer(4),
        mkRow([ mkIcon('iphone', C.textSub, 10), mkSpacer(4), mkText(localIP, 10, C.textSub, 'regular', { maxLines: 1 }) ]), mkSpacer(2),
        mkRow([ mkIcon('wifi.router', C.textSub, 11), mkSpacer(3), mkText(gatewayIP, 10, C.textSub, 'regular', { maxLines: 1 }) ])
      ], { alignItems: 'start', flex: 1 })
    ]),
    mkSpacer(),
    mkRow([
      renderDataBlock('network', '本地IP', local.ip || '获取中...'), mkSpacer(6),
      renderDataBlock('stopwatch', '本地延迟', localInfo.ping ? `${localInfo.ping} ms` : '-- ms', C.green)
    ]),
    mkSpacer(8),
    mkRow([
      renderDataBlock('mappin.and.ellipse', '地理位置', exactLocation), mkSpacer(6),
      renderDataBlock('globe', 'IP类型', currentIpType)
    ])
  ], { flex: 1, backgroundColor: C.cardBg, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.cardBorder });

  const proxyBox = mkCol([
    mkRow([
      mkText(getFlagEmoji(cc), 26, C.textMain), mkSpacer(8),
      mkCol([
        mkText(proxyIP, 13, C.textMain, 'bold', { maxLines: 1, minScale: 0.3 }), mkSpacer(2),
        mkRow([ mkIcon('building.2', C.textSub, 10), mkSpacer(4), mkText(nodeIsp, 10, C.textSub, 'regular', { maxLines: 1 }) ]), mkSpacer(2),
        mkRow([ mkIcon('server.rack', C.textSub, 10), mkSpacer(4), mkText(asnStr, 9, C.textSub, 'regular', { maxLines: 1 }) ])
      ], { alignItems: 'start', flex: 1 })
    ]),
    mkSpacer(),
    mkRow([
      renderDataBlock('building.2.fill', 'IP属性', isResidential ? '住宅IP' : '机房IP', residentialColorHex), mkSpacer(6),
      renderDataBlock('stopwatch', '节点延迟', nodeInfo.ping ? `${nodeInfo.ping} ms` : '-- ms', C.purple)
    ]),
    mkSpacer(8),
    mkRow([
      renderDataBlock('checkmark.shield.fill', '原生状态', isResidential ? '原生' : '非原生', residentialColorHex), mkSpacer(6),
      renderDataBlock('shield.checkerboard', '纯净评分', `${pureScore} / 100`, activePureColorHex)
    ])
  ], { flex: 1, backgroundColor: C.cardBg, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.cardBorder });

  return {
    type: 'widget', backgroundColor: C.bg, padding: 12,
    children: [
      headerRow, mkSpacer(10),
      mkRow([ localBox, mkSpacer(8), proxyBox ], { flex: 1 }), mkSpacer(10),
      mkRow(allServices.slice(0, 4).map(ServiceBlock), { gap: 8 }), mkSpacer(8),
      mkRow(allServices.slice(4, 8).map(ServiceBlock), { gap: 8 })
    ]
  };
}
