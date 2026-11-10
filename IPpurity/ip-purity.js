/**
 * IP 纯净度 · Egern 小组件（数据来自 IPPure）
 *
 * 接口：https://my.ippure.com/v1/info（IPPure 公开接口，测试阶段）
 *   fraudScore     风险分 0–100，越高越容易被风控；IPv6 不评分
 *   isResidential  住宅宽带 / 机房
 *   isBroadcast    广播 IP（注册地和所在地不同）/ 原生 IP
 *   asOrganization 组织；有时是这段 IP 的使用方，不是 AS 的持有者
 * 运营商另用 ASN 去 RIPEstat 查 AS 的持有者（跟官网 ASN 那一栏一致），按 ASN 缓存 30 天，查不到时用 asOrganization：
 *   https://stat.ripe.net/data/as-overview/data.json?resource=AS<asn>   data.holder
 *
 * 样式：照 IPPure 官网的色条，画成一张 SVG。六档等宽连成一条，从左到右极净到极险，颜色取自官网；
 * 色条上方是那一档颜色的标签，写「分数% 档位名」，标签下的小三角指着分数的确切位置
 * （每档占六分之一，档内按分数线性）；色条下方是分界刻度 0 15 25 40 50 70 100。
 * 分档跟官网一致：0–15 极度纯净，16–25 纯净，26–40 中性，41–50 轻度风险，51–70 中度风险，71–100 极度风险，
 * 分界值归前一档。标签写官网全称；锁屏地方小，用两个字的简称（极净、纯净、中性、轻险、中险、极险）。
 *
 * 布局注意（真机上确认过）：Egern 里带 flex 的元素横竖两个方向都会撑满，写了 height 也只是可见部分的高度；
 * 装着它的 row 会跟着被纵向拉高，同一列里的 spacer 被压成 0。所以凡是装着 flex 子元素的 row 都写明 height。
 * 另外，带 flex 的文字在自己那一格里靠左；带 flex 的 stack 如果自己不铺满，会被摆在那一格的中间；
 * 固定长度的 spacer 在交叉方向上会撑满（col 里的 spacer(5) 会让整列横向铺满）。
 *
 * 模块：egern/module/IP_Purity_Widget.yaml
 *
 * Env（都可选）：
 *   POLICY           检测哪个策略组或节点的出口 IP；留空按 Egern 分流规则
 *   MARK_IP          IP 打码，默认 true
 *   REFRESH_MINUTES  刷新间隔（分钟），默认 10
 *   LABEL            名称，用来区分多个小组件（小号、中号在右下角；大号不显示，「检测」那一行已经写了策略）；不填时显示检测策略名
 */

const API_URL = 'https://my.ippure.com/v1/info';
const SITE_URL = 'https://ippure.com/';
const TIMEOUT = 8000;
const ASN_URL = 'https://stat.ripe.net/data/as-overview/data.json?resource=AS';
const ASN_TIMEOUT = 4000;
const ASN_TTL = 30 * 24 * 3600 * 1000; // 查到的持有者存 30 天
const ASN_RETRY = 3600 * 1000; // 没查到（超时、出错）1 小时后再试，免得每次刷新都多等几秒

// 底色取 CF 探针「流量延迟版」渐变最上方的颜色（纯色，不渐变），文字灰度也跟它一致；
// 彩色只用来表达含义。good、bad 是官网的那一对绿和粉（官网「人机流量比」里 human、bot 用的就是它们）：
// 原生、住宅这些对代理有利的用 good，广播、机房用 bad
const C = {
  bg: { light: '#FFFFFF', dark: '#161B22' },
  ink: { light: '#1F2328', dark: '#E6EDF3' },
  soft: { light: '#59636E', dark: '#8B949E' },
  faint: { light: '#818B98', dark: '#6E7681' },
  good: { light: '#48C78E', dark: '#48C78E' },
  bad: { light: '#FE6685', dark: '#FE6685' },
  warn: { light: '#B4600F', dark: '#F0A040' },
};

// 每档的颜色就是 IPPure 官网色条的颜色（Tailwind 的 green-800、green-500、lime-500、yellow-500、orange-500、red-600；
// 官网截图是 Display P3，按 P3 换回 sRGB 后就是这几个值）。max 是这一档的上限，分界值归前一档；
// name 是官网的名称（标签用），short 是两个字的简称（锁屏用）
const BANDS = [
  { max: 15, name: '极度纯净', short: '极净', color: '#166534' },
  { max: 25, name: '纯净', short: '纯净', color: '#22C55E' },
  { max: 40, name: '中性', short: '中性', color: '#84CC16' },
  { max: 50, name: '轻度风险', short: '轻险', color: '#EAB308' },
  { max: 70, name: '中度风险', short: '中险', color: '#F97316' },
  { max: 100, name: '极度风险', short: '极险', color: '#DC2626' },
];

// 全部用系统字体（SF Pro）。行框单位是字号：上沿到基线 0.95，基线到下沿 0.24
const FONT = { ascent: 0.95, descent: 0.24 };
const lineHeight = size => (FONT.ascent + FONT.descent) * size;

const COUNTRY_ZH = {
  HK: '香港', MO: '澳门', TW: '台湾', CN: '中国', JP: '日本', KR: '韩国', SG: '新加坡', MY: '马来西亚',
  TH: '泰国', VN: '越南', PH: '菲律宾', ID: '印尼', IN: '印度', AU: '澳大利亚', NZ: '新西兰', US: '美国',
  CA: '加拿大', MX: '墨西哥', BR: '巴西', AR: '阿根廷', CL: '智利', GB: '英国', IE: '爱尔兰', DE: '德国',
  FR: '法国', NL: '荷兰', BE: '比利时', LU: '卢森堡', CH: '瑞士', AT: '奥地利', IT: '意大利', ES: '西班牙',
  PT: '葡萄牙', SE: '瑞典', NO: '挪威', DK: '丹麦', FI: '芬兰', PL: '波兰', CZ: '捷克', RO: '罗马尼亚',
  BG: '保加利亚', HU: '匈牙利', GR: '希腊', UA: '乌克兰', TR: '土耳其', IL: '以色列', AE: '阿联酋',
  SA: '沙特', QA: '卡塔尔', ZA: '南非', EG: '埃及', NG: '尼日利亚', KZ: '哈萨克斯坦', RU: '俄罗斯',
  PK: '巴基斯坦', BD: '孟加拉',
};

// 常见落地城市中文名（接口给的城市是英文，命中就显示中文；没收录的保持英文原样）
const CITY_ZH = {
  'los angeles': '洛杉矶', 'dallas': '达拉斯', 'san jose': '圣何塞', 'seattle': '西雅图',
  'new york': '纽约', 'chicago': '芝加哥', 'ashburn': '阿什本', 'phoenix': '凤凰城',
  'miami': '迈阿密', 'denver': '丹佛', 'atlanta': '亚特兰大', 'las vegas': '拉斯维加斯',
  'silicon valley': '硅谷', 'london': '伦敦', 'frankfurt': '法兰克福', 'amsterdam': '阿姆斯特丹',
  'paris': '巴黎', 'tokyo': '东京', 'osaka': '大阪', 'seoul': '首尔',
  'singapore': '新加坡', 'sydney': '悉尼', 'melbourne': '墨尔本', 'toronto': '多伦多',
  'vancouver': '温哥华', 'mumbai': '孟买', 'hong kong': '香港', 'taipei': '台北',
  'zurich': '苏黎世', 'madrid': '马德里', 'stockholm': '斯德哥尔摩', 'warsaw': '华沙',
};

// ───────────────────────────── 入口 ─────────────────────────────

export default async function (ctx) {
  const cfg = readEnv(ctx);
  const family = ctx.widgetFamily || 'systemMedium';
  let m;
  try {
    const info = await getInfo(ctx, cfg);
    m = buildModel(info.data, cfg, info.holder || '', info.ts);
  } catch (error) {
    const err = error instanceof WidgetError ? error : new WidgetError('出错了', shorten(error?.message || error, 80));
    return errorWidget(family, cfg, err);
  }

  switch (family) {
    case 'accessoryInline': return inlineWidget(m);
    case 'accessoryCircular': return circularWidget(m);
    case 'accessoryRectangular': return rectangularWidget(m);
    case 'systemSmall': return smallWidget(m);
    case 'systemLarge':
    case 'systemExtraLarge': return largeWidget(m);
    default: return mediumWidget(m);
  }
}

function readEnv(ctx) {
  const env = ctx.env || {};
  const get = key => String(env[key] ?? '').trim();
  const minutes = Number(get('REFRESH_MINUTES'));
  return {
    policy: get('POLICY'),
    markIP: !/^(false|0|no|off)$/i.test(get('MARK_IP')),
    refreshMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.min(720, Math.max(5, minutes)) : 10,
    label: get('LABEL'),
  };
}

// ───────────────────────────── 数据 ─────────────────────────────

class WidgetError extends Error {
  constructor(title, hint) {
    super(title);
    this.title = title;
    this.hint = hint || '';
  }
}

async function fetchInfo(ctx, cfg) {
  const options = { timeout: TIMEOUT };
  if (cfg.policy) options.policy = cfg.policy;

  let text = '';
  try {
    const response = await ctx.http.get(API_URL, options);
    const status = Number(response.status);
    text = await response.text();
    if (status >= 400) throw httpError(status, cfg);
  } catch (error) {
    if (error instanceof WidgetError) throw error;
    const message = String(error?.message || error || '');
    // Egern 收到 4xx/5xx 时不返回响应，而是抛出「HTTP error! status: 429, body: …」
    const thrown = message.match(/HTTP error!?\s*status:?\s*(\d{3})/i);
    if (thrown) throw httpError(Number(thrown[1]), cfg);
    const where = cfg.policy ? `检查策略「${cfg.policy}」是否可用。` : '检查网络和分流规则。';
    const title = /timed?\s*out|timeout/i.test(message) ? '连接 IPPure 超时' : '连不上 IPPure';
    throw new WidgetError(title, `${where}${shorten(message, 60)}`);
  }

  const data = parseJSON(text);
  if (!data || typeof data !== 'object') throw new WidgetError('IPPure 没返回数据', '接口可能在维护，稍后会自动重试。');
  if (!data.ip) throw new WidgetError('IPPure 没返回 IP', '接口可能在维护，稍后会自动重试。');
  return data;
}

// 主数据缓存（自托管优化版新增）：原版每次刷新都实打实请求 IPPure，免费接口容易被刷到 429，
// 一失败小组件就只剩错误页。这里按策略分键把成功结果存进 ctx.storage：
// 刷新间隔内直接用缓存不再请求；请求失败时回退 24 小时内的旧数据先顶着（时间显示数据时刻，一眼能看出是旧的），
// 从没成功过才显示错误页。同时用上次缓存的 ASN 并行预取运营商持有者，稳态下省掉一次串行等待。
const INFO_STALE_LIMIT = 24 * 3600 * 1000;

async function getInfo(ctx, cfg) {
  const key = `ippure_info_${cfg.policy || 'default'}`;
  const cached = storageGet(ctx, key);
  const usable = cached && typeof cached === 'object' && cached.data && Number(cached.ts || 0) > 0 ? cached : null;
  const now = Date.now();
  if (usable && now - Number(usable.ts) < cfg.refreshMinutes * 60000) {
    return { data: usable.data, ts: Number(usable.ts), holder: await asHolder(ctx, cfg, usable.data.asn) };
  }
  const holderPromise = usable && usable.data.asn ? asHolder(ctx, cfg, usable.data.asn) : Promise.resolve('');
  try {
    const data = await fetchInfo(ctx, cfg);
    storageSet(ctx, key, { data, ts: now });
    let holder = await holderPromise;
    if (!holder || Number(usable?.data?.asn || 0) !== Number(data.asn || 0)) {
      holder = await asHolder(ctx, cfg, data.asn);
    }
    return { data, ts: now, holder };
  } catch (error) {
    if (usable && now - Number(usable.ts) < INFO_STALE_LIMIT) {
      const holder = (await holderPromise) || (await asHolder(ctx, cfg, usable.data.asn));
      return { data: usable.data, ts: Number(usable.ts), holder };
    }
    throw error;
  }
}

function httpError(status, cfg) {
  if (status === 429) return new WidgetError('IPPure 请求太频繁', '稍后会自动重试，也可以把刷新间隔调大。');
  if (status === 403) {
    const node = cfg.policy ? `（当前策略「${cfg.policy}」）` : '';
    return new WidgetError('IPPure 拒绝了这次请求', `出口可能被它拦截，换个节点试试${node}。`);
  }
  return new WidgetError(`IPPure 出错，HTTP ${status}`, '稍后会自动重试。');
}

// 运营商：用 ASN 去 RIPEstat 查这个 AS 登记的持有者，官网 ASN 那一栏显示的就是它。
// IPPure 接口的 asOrganization 有时是这段 IP 的使用方：比如 IIJ（AS2497）分给 Stacks Inc. 的地址，
// 官网写 Internet Initiative Japan Inc.，接口给的是 Stacks Inc.。
// 按 ASN 缓存在 ctx.storage：查到的存 30 天；没查到记下来，1 小时后再试，期间沿用上次查到的名称。
// 从不抛错，拿不到就返回空字符串，外面退回 asOrganization
async function asHolder(ctx, cfg, asn) {
  const num = Number(asn);
  if (!(num > 0)) return '';
  const key = `ippure_as_holder_${num}`;
  const now = Date.now();
  const cached = storageGet(ctx, key);
  const known = cached && typeof cached === 'object' ? String(cached.name || '') : '';
  if (cached && now - Number(cached.ts || 0) < (cached.failed ? ASN_RETRY : ASN_TTL)) return known;
  try {
    const options = { timeout: ASN_TIMEOUT };
    if (cfg.policy) options.policy = cfg.policy;
    const response = await ctx.http.get(ASN_URL + num, options);
    const name = holderName(parseJSON(await response.text())?.data?.holder);
    storageSet(ctx, key, { name, ts: now });
    return name;
  } catch {
    storageSet(ctx, key, { name: known, ts: now, failed: true });
    return known;
  }
}

// RIPEstat 的 holder 多是「AS 名 + 持有者」：ARIN 的写成「CLOUDFLARENET - Cloudflare, Inc.」，
// APNIC、RIPE 的写成「IIJ Internet Initiative Japan Inc.」「OVH OVH SAS」。去掉前面的 AS 名
// （全是大写字母、数字、连字符的那一段），只留持有者；剩下的像地址（「No.31,Jin-rong Street」）就不要
function holderName(holder) {
  const text = String(holder || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const dash = text.indexOf(' - ');
  if (dash > 0) return text.slice(dash + 3).trim();
  const parts = text.match(/^([A-Z0-9][A-Z0-9_-]*) (.+)$/);
  const rest = parts ? parts[2] : '';
  const name = rest && (/[a-z]/.test(rest) || rest.toUpperCase().includes(parts[1])) ? rest : text;
  return /\d\s*,|^No\.?\s*\d/i.test(name) ? '' : name;
}

// Egern 的 ctx.storage 读写 JSON；用不了就当没有缓存
function storageGet(ctx, key) {
  try {
    return ctx.storage.getJSON(key) ?? null;
  } catch {
    return null;
  }
}

function storageSet(ctx, key, value) {
  try {
    ctx.storage.setJSON(key, value);
  } catch {
    // 存不了下次再查
  }
}

function buildModel(data, cfg, holder, ts) {
  const ip = String(data.ip);
  const score = readScore(data.fraudScore);
  const code = String(data.countryCode || '').trim().toUpperCase();
  const country = COUNTRY_ZH[code] || String(data.country || code || '未知地区');
  const rawCity = String(data.city || data.region || '').trim();
  const city = CITY_ZH[rawCity.toLowerCase()] || rawCity;
  const sameAsCountry = !city || [country, data.country, code].some(x => x && String(x).toLowerCase() === city.toLowerCase());

  return {
    ip,
    shownIP: cfg.markIP ? maskIP(ip) : ip,
    isV6: ip.includes(':'),
    score,
    band: score === null ? null : BANDS.find(band => Math.round(score) <= band.max),
    flag: flagEmoji(code),
    country,
    city: sameAsCountry ? '' : city,
    asn: Number(data.asn) > 0 ? `AS${Number(data.asn)}` : '',
    org: holder || String(data.asOrganization || '').trim(),
    residential: readBool(data.isResidential),
    broadcast: readBool(data.isBroadcast),
    name: cfg.label || cfg.policy,
    policy: cfg.policy,
    time: ts ? clockOf(ts) : clock(),
    refreshMinutes: cfg.refreshMinutes,
  };
}

function readScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

function readBool(value) {
  if (value === true || value === 'true' || value === 1) return true;
  if (value === false || value === 'false' || value === 0) return false;
  return null;
}

// 原生 / 广播，住宅 / 机房：对代理用户有利的一侧用 good 的绿，另一侧用 bad 的粉，跟官网一样。
// short 用在小号、中号的底行，long 用在大号的详情里（不加说明，机房、广播后面不再解释）
function traits(m) {
  const list = [];
  if (m.broadcast !== null) {
    list.push(m.broadcast
      ? { icon: 'dot.radiowaves.left.and.right', short: '广播', long: '广播 IP', good: false }
      : { icon: 'checkmark.seal.fill', short: '原生', long: '原生 IP', good: true });
  }
  if (m.residential !== null) {
    list.push(m.residential
      ? { icon: 'house.fill', short: '住宅', long: '住宅宽带', good: true }
      : { icon: 'server.rack', short: '机房', long: '机房', good: false });
  }
  return list;
}

// ───────────────────────────── 小工具 ─────────────────────────────

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function shorten(value, max) {
  const text = String(value ?? '').replace(/^\w*Error:\s*/, '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function maskIP(ip) {
  if (ip.includes(':')) {
    // 按 :: 切开取头尾段，不能把空段滤掉再数，否则压缩写法下段位会错位
    const halves = ip.split('::');
    const head = (halves[0] || '').split(':').filter(Boolean);
    const tail = halves.length > 1 ? (halves[1] || '').split(':').filter(Boolean) : [];
    const first = head.slice(0, 2).join(':');
    const last = tail.length ? tail[tail.length - 1] : head[head.length - 1];
    return first && last ? `${first}:••:${last}` : ip;
  }
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.••.${parts[3]}` : ip;
}

function flagEmoji(code) {
  if (!/^[A-Z]{2}$/.test(code)) return '🌐';
  return String.fromCodePoint(...[...code].map(char => 127397 + char.charCodeAt(0)));
}

function clock() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function clockOf(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function refreshAt(minutes) {
  return new Date(Date.now() + minutes * 60000).toISOString();
}

// ───────────────────────────── DSL ─────────────────────────────

// 文字一律用系统字体（不写 family）
function T(text, size, color, weight = 'regular', extra = {}) {
  const el = { type: 'text', text: String(text), font: { size, weight }, maxLines: 1 };
  if (color) el.textColor = color;
  return { ...el, ...extra };
}

function row(children, extra = {}) {
  return { type: 'stack', direction: 'row', alignItems: 'center', children: children.filter(Boolean), ...extra };
}

function col(children, extra = {}) {
  return { type: 'stack', direction: 'column', alignItems: 'start', children: children.filter(Boolean), ...extra };
}

function spacer(length) {
  return length === undefined ? { type: 'spacer' } : { type: 'spacer', length };
}

function icon(name, size, color) {
  const el = { type: 'image', src: `sf-symbol:${name}`, width: size, height: size };
  if (color) el.color = color;
  return el;
}

function center(child, height) {
  return row([spacer(), child, spacer()], height ? { height } : {});
}

// ───────────────────────────── 色条 ─────────────────────────────

const TICKS = [0, 15, 25, 40, 50, 70, 100];
const TICK_GRAY = '#888888'; // 官网刻度的灰，白底和深色底上都看得清，所以 SVG 不用分深浅模式
const SVG_FONT = "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";

// 色条参数（pt，按 iPhone 15/16 的尺寸）：width 是画布宽度，inset 是色条离画布左右两边的距离。
// 画布一直伸到小组件右边缘（小号、大号左右都伸到边），色条两端仍跟上下几行的内容对齐，
// 100 才能像官网那样居中在色条末端、往外伸出一点。font 是标签字号，bar 是色条厚度，tick 是刻度字号（0 不画刻度）
const METER = {
  small: { width: 158, inset: [13, 13], font: 10, bar: 4, tick: 0 }, // 小号的纯净度只当配角，缩小、不画刻度
  medium: { width: 148, inset: [0, 16], font: 11, bar: 6, tick: 8.5 },
  large: { width: 338, inset: [16, 16], font: 15, bar: 8, tick: 11 }, // 比 IP（22）小，不跟 IP 抢
};

// 分数在色条上的位置（0–1）：每档占六分之一，档内按分数线性。官网就是这样：61 分在 50–70 这档的 55% 处
function position(score, band) {
  const i = BANDS.indexOf(band);
  const lo = i === 0 ? 0 : BANDS[i - 1].max;
  return (i + (score - lo) / (band.max - lo)) / BANDS.length;
}

// 粗估文字宽度，单位是字号：数字 0.62，% 0.9，空格 0.28，中文 1
function textEm(text) {
  let em = 0;
  for (const ch of text) em += /\d/.test(ch) ? 0.62 : ch === '%' ? 0.9 : /\s/.test(ch) ? 0.28 : /[　-鿿]/.test(ch) ? 1 : 0.62;
  return em;
}

// 色条画成 SVG，比例照官网量的：标签高 1.5 个字号，左右各留 0.75 个字号，圆角 0.2 个字号，
// 分数和档位名之间空两个空格；小三角宽 0.7、高 0.5 个字号，尖端离色条 0.08 个字号；
// 六档等宽、连在一起、两端直角；刻度在色条下方，跟官网一样 0 靠左对齐色条左端，100 居中在色条右端，其余对准分界。
// 标签以分数位置为中心，碰到色条两端就停在边上；小三角的尖端仍然指着分数位置，
// 底边最多挪到标签的边上（压住圆角，像对话气泡的尾巴）。没有分数时（IPv6 或接口没给）是灰色标签写原因，不画小三角
function meterSvg(m, p) {
  const W = p.width;
  const f = p.font;
  const r = n => Math.round(n * 100) / 100;
  const x0 = p.inset[0];
  const x1 = W - p.inset[1];
  const segment = (x1 - x0) / BANDS.length;
  const badgeH = Math.round(f * 1.5);
  const arrowW = Math.round(f * 0.7);
  const arrowH = Math.round(f * 0.5);
  const barY = badgeH + arrowH + Math.max(1, Math.round(f * 0.08));
  // 刻度：色条下面空 0.35 个字号，数字高 0.7 个字号。真机上量过，Egern 画刻度数字比写的基线低约 0.17 个字号
  // （标签里的粗体字没有这个偏差），所以基线先往上挪回来；画布底下再多留 0.3 个字号，偏差再大一点也不会被裁
  const tickShift = p.tick * 0.17;
  const tickBase = barY + p.bar + Math.round(p.tick * 0.35) + p.tick * 0.7 - tickShift;
  const height = p.tick ? Math.ceil(tickBase + tickShift + p.tick * 0.3) : barY + p.bar + 1;

  // 相邻两段多画半点，免得接缝处透出底色
  const bar = BANDS.map((band, i) => {
    const w = segment + (i < BANDS.length - 1 ? 0.5 : 0);
    return `<rect x="${r(x0 + i * segment)}" y="${barY}" width="${r(w)}" height="${p.bar}" fill="${band.color}"/>`;
  }).join('');

  const ticks = !p.tick ? '' : TICKS.map((t, i) => {
    const anchor = i === 0 ? 'start' : 'middle';
    return `<text x="${r(x0 + i * segment)}" y="${r(tickBase)}" text-anchor="${anchor}" font-size="${p.tick}" fill="${TICK_GRAY}">${t}</text>`;
  }).join('');

  // 分数和档位名之间用两个不换行空格：普通空格在 SVG 文字里会合并成一个
  const score = m.score === null ? null : Math.round(m.score);
  const label = score === null ? (m.isV6 ? 'IPv6 不评分' : '暂无评分') : `${score}%\u00A0\u00A0${m.band.name}`;
  const fill = score === null ? TICK_GRAY : m.band.color;
  const bw = Math.ceil((textEm(label) + 1.5) * f);
  const x = score === null ? (x0 + x1) / 2 : x0 + position(score, m.band) * (x1 - x0);
  const bx = Math.min(Math.max(x - bw / 2, x0), x1 - bw);
  let badge = `<rect x="${r(bx)}" y="0" width="${bw}" height="${badgeH}" rx="${r(f * 0.2)}" fill="${fill}"/>` +
    `<text x="${r(bx + bw / 2)}" y="${r(badgeH / 2 + f * 0.36)}" text-anchor="middle" font-size="${f}" font-weight="700" fill="#FFFFFF">${label}</text>`;
  if (score !== null) {
    const base = Math.min(Math.max(x, bx + arrowW / 2), bx + bw - arrowW / 2);
    const tip = Math.min(Math.max(x, x0 + 0.5), x1 - 0.5);
    badge += `<path d="M${r(base - arrowW / 2)} ${badgeH - 0.5}L${r(base + arrowW / 2)} ${badgeH - 0.5}L${r(tip)} ${badgeH + arrowH}Z" fill="${fill}"/>`;
  }

  // 宽高写成 3 倍：万一 Egern 按图片自身尺寸栅格化，缩到框里也够清楚；坐标都在 viewBox 里，单位是 pt
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 3}" height="${height * 3}" viewBox="0 0 ${W} ${height}" font-family="${SVG_FONT}">${bar}${ticks}${badge}</svg>`;
  return { svg, height, badgeH };
}

// 色条图片：横向铺满，按宽度等比缩放（contain）。Egern 不告诉脚本小组件有多宽，
// 所以框比画布高 12%：最宽的手机（Pro Max）上也是宽度先铺满，别的手机上下各空出一点。
// 位置都按比例，不会偏；宽一些的手机上字也跟着大一点，色条两端跟内容最多差一点。框有 flex，所以这一行写明高度
function meter(m, p) {
  const { svg, height, badgeH } = meterSvg(m, p);
  const frame = Math.ceil(height * 1.12);
  const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg).replace(/'/g, '%27');
  const view = row([{ type: 'image', src, resizable: true, resizeMode: 'contain', flex: 1, height: frame }], { height: frame });
  return { view, frame, height, badgeH };
}

// ───────────────────────────── 布局 ─────────────────────────────

function placeRow(m, size, withCity) {
  return row([
    T(m.flag, size),
    T(m.country, size, C.ink, 'semibold'),
    withCity && m.city ? T(m.city, size, C.soft, 'regular', { minScale: 0.6 }) : null,
    spacer(),
    T(m.time, Math.max(9, size - 3), C.faint, 'medium'),
  ], { gap: 5 });
}

// IP 是这台出口的身份，用深色大字，不再当成次要信息；没打码的 IPv6 很长，允许缩得更小
function ipText(m, size, extra = {}) {
  return T(m.shownIP, size, C.ink, 'bold', { minScale: m.shownIP.length > 18 ? 0.4 : 0.6, ...extra });
}

// 「标签 + 值」一行：标签浅灰小字、固定宽度，几行的值从同一条竖线开始。
// 值带 flex（文字在格子里才会靠左、太长时才能缩小），所以这一行会被撑高，用的地方要写明高度
function field(label, value, labelWidth, labelSize) {
  return row([
    { type: 'stack', direction: 'row', width: labelWidth, children: [T(label, labelSize, C.faint, 'medium'), spacer()] },
    { ...value, flex: 1 },
  ], { gap: 6 });
}

// 粗估文字宽度，用来判断运营商名称会不会折成两行（中文 1 个字号，大写和数字 0.64，小写 0.53）
function estimateWidth(text, size) {
  let em = 0;
  for (const ch of text) em += /[　-鿿]/.test(ch) ? 1 : /[A-Z0-9]/.test(ch) ? 0.64 : /[a-z]/.test(ch) ? 0.53 : 0.3;
  return em * size;
}

// 图标用 good / bad 的颜色，文字一律正文色
function traitView(t, size) {
  return row([
    icon(t.icon, size, t.good ? C.good : C.bad),
    T(t.short, size + 1, C.ink, 'medium'),
  ], { gap: 3 });
}

function root(children, padding, m) {
  return {
    type: 'widget',
    backgroundColor: C.bg,
    padding,
    gap: 0,
    url: SITE_URL,
    refreshAfter: refreshAt(m.refreshMinutes),
    children: children.filter(Boolean),
  };
}

// 标题行：国旗、国家（次要色）、城市（浅色），右边是名称和时间（浅色）。字比 IP 小，只当说明，不跟 IP 抢
function captionRow(m, size, withCity, name) {
  return row([
    T(m.flag, size),
    T(m.country, size, C.soft, 'semibold'),
    withCity && m.city ? T(m.city, size, C.faint, 'medium', { minScale: 0.6 }) : null,
    spacer(),
    name ? T(name, size - 1, C.faint, 'medium', { minScale: 0.7 }) : null,
    T(m.time, size - 1, C.faint, 'medium'),
  ], { gap: 5 });
}

// IP 单独一行。行里有 flex 的文字，所以写明行高（不能小于字的行高，否则会被缩小）
function heroIP(m, size) {
  return row([ipText(m, size, { flex: 1 })], { height: Math.ceil(lineHeight(size)) });
}

// 小号 IP 下面的运营商：不加标签，跟 IP 左对齐，用次要色当补充说明；放不下时自己折成两行。
// 不用 flex、不写行高：写死两行高度时，一行放得下的名称会在框里上下居中，跟 IP 之间平白多出半行空隙；
// 后面垫一个 spacer，这一行才会铺满、文字靠左
function smallOrg(m, size) {
  if (!m.org) return null;
  return row([T(m.org, size, C.soft, 'medium', { maxLines: 2 }), spacer()], { alignItems: 'start' });
}

// 底行：左边类型，右边名称（跟中号一样）
function footRow(m, size) {
  return row([
    ...traits(m).map(t => traitView(t, size)),
    spacer(),
    m.name ? T(m.name, size - 1, C.faint, 'medium', { minScale: 0.7 }) : null,
  ], { gap: 8 });
}

// 小号：上半部是标题（地区、时间）、IP 和运营商；纯净度缩小、不画刻度，放在运营商和底行正中间；
// 底行左边类型、右边名称。根容器不留左右边距，改到各行上（side），色条的画布才能横跨整个小组件
function smallWidget(m) {
  const side = el => ({ ...el, padding: [0, 13, 0, 13] });
  const org = smallOrg(m, 10.5);
  return root([
    side(captionRow(m, 12, false)),
    spacer(9),
    side(heroIP(m, 16)),
    org ? spacer(7) : null,
    org ? side(org) : null,
    spacer(),
    meter(m, METER.small).view,
    spacer(),
    side(footRow(m, 10)),
  ], [13, 0, 12, 0], m);
}

// 中号：顶行地区和时间；中间左右分栏（40:37，参考尺寸下左 160、右 148）：左边 IP（靠左，不加标签）、ASN、
// 运营商（标签和值都是 10pt），右边色条，标签的中线跟 IP 那一行的中线对齐；底行类型和名称。
// 右边距放在顶行和底行上，右栏的画布伸到小组件右边缘。中间这一行写明高度，上下多出的空间由 spacer 平分
function mediumWidget(m) {
  const ipSize = 20;
  const labelWidth = 32;
  const labelSize = 10;

  // IP 那一行不能矮于 IP 的行高，否则带 minScale 的 IP 会被缩小
  const headHeight = Math.ceil(lineHeight(ipSize));

  // ASN 在上，运营商在下；运营商名称太长时折成两行（按最窄的中号估算）
  const valueSize = 10;
  const ipGap = 12; // IP 和 ASN 之间多留的空隙
  const orgLines = m.org && estimateWidth(m.org, valueSize) > 122 ? 2 : 1;
  const asnHeight = 14;
  const orgHeight = orgLines === 2 ? 27 : 14;
  const asnRow = m.asn
    ? { ...field('ASN', T(m.asn, valueSize, C.ink, 'semibold'), labelWidth, labelSize), height: asnHeight }
    : null;
  const orgRow = m.org
    ? { ...field('运营商', T(m.org, valueSize, C.ink, 'semibold', { maxLines: orgLines }), labelWidth, labelSize), height: orgHeight }
    : null;
  const hasDetails = asnRow || orgRow;
  const leftHeight = headHeight + (hasDetails ? ipGap : 0) + (asnRow ? asnHeight : 0) + (orgRow ? orgHeight : 0) + (asnRow && orgRow ? 6 : 0);
  const left = col([
    row([ipText(m, ipSize, { flex: 1 })], { height: headHeight }),
    hasDetails ? spacer(ipGap) : null,
    asnRow,
    asnRow && orgRow ? spacer(6) : null,
    orgRow,
    spacer(),
  ]);

  // 图片在框里上下居中，参考宽度下上面空出 (frame - height) / 2；再往下挪一点，让标签中线落在 IP 那一行中间
  const gauge = meter(m, METER.medium);
  const lift = Math.max(0, Math.round(headHeight / 2 - (gauge.frame - gauge.height) / 2 - gauge.badgeH / 2));
  const right = col([lift ? spacer(lift) : null, gauge.view, spacer()]);

  return root([
    { ...placeRow(m, 13, true), padding: [0, 16, 0, 0] },
    spacer(),
    row([{ ...left, flex: 40 }, { ...right, flex: 37 }], { gap: 14, alignItems: 'start', height: Math.max(leftHeight, lift + gauge.frame) }),
    spacer(),
    row([
      ...traits(m).map(t => traitView(t, 10)),
      spacer(),
      m.name ? T(m.name, 10, C.faint, 'medium', { minScale: 0.7 }) : null,
    ], { gap: 10, padding: [0, 16, 0, 0] }),
  ], [14, 0, 13, 16], m);
}

// 值的颜色：属性、来源对代理有利的用 good，不利的用 bad；其他行不传 good，用正文色
function detail(label, value, good) {
  const color = good === true ? C.good : good === false ? C.bad : C.ink;
  return row([
    { type: 'stack', direction: 'row', width: 46, children: [T(label, 13, C.faint, 'medium'), spacer()] },
    T(value, 13, color, 'medium', { minScale: 0.7, flex: 1 }), // 跟标签一样大，靠颜色区分
  ], { gap: 8, height: 24 }); // 不低于中文的行高，否则带 minScale 的文字会被缩小
}

// 大号：跟小号一样，左右边距放在各行上，色条的画布横跨整个小组件。
// IP 和纯净度挨在一起（固定空 18），算一组；顶行和 IP 之间、纯净度和详情之间各放一个 spacer，平分剩下的高度。
// IP 右边不放名称：下面「检测」那一行已经写了策略
function largeWidget(m) {
  const kinds = traits(m);
  const source = kinds.find(t => t.short === '原生' || t.short === '广播');
  const kind = kinds.find(t => t.short === '住宅' || t.short === '机房');
  const side = el => ({ ...el, padding: [0, 16, 0, 16] });
  return root([
    side(placeRow(m, 16, true)),
    spacer(),
    side(heroIP(m, 22)),
    spacer(18),
    meter(m, METER.large).view,
    spacer(),
    side(col([
      detail('属性', kind ? kind.long : '未知', kind?.good),
      detail('来源', source ? source.long : '未知', source?.good),
      detail('ASN', m.asn || '未知'),
      detail('运营商', m.org || '未知'),
      detail('检测', m.policy ? `策略「${m.policy}」` : '跟随分流规则'),
    ], { gap: 8 })),
  ], [16, 0, 15, 0], m);
}

// ───────────────────────────── 锁屏 ─────────────────────────────

function gaugeSvg(ratio) {
  const point = deg => {
    const rad = (deg * Math.PI) / 180;
    return `${(50 + 40 * Math.sin(rad)).toFixed(2)} ${(50 - 40 * Math.cos(rad)).toFixed(2)}`;
  };
  const arc = (from, to, stroke) =>
    `<path d='M ${point(from)} A 40 40 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}' fill='none' stroke='${stroke}' stroke-width='9' stroke-linecap='round'/>`;
  const p = Math.min(1, Math.max(0, ratio));
  const track = arc(-135, 135, 'rgba(255,255,255,0.3)');
  const value = p > 0.01 ? arc(-135, -135 + 270 * p, 'rgb(255,255,255)') : '';
  return `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>${track}${value}</svg>`;
}

function circularWidget(m) {
  return {
    type: 'widget',
    padding: 0,
    url: SITE_URL,
    refreshAfter: refreshAt(m.refreshMinutes),
    children: [{
      type: 'stack',
      direction: 'column',
      alignItems: 'center',
      flex: 1,
      backgroundImage: gaugeSvg(m.score === null ? 0 : m.score / 100),
      children: [
        spacer(),
        center(T(m.score === null ? '—' : String(Math.round(m.score)), 18, null, 'bold')),
        center(T(m.band ? m.band.short : m.isV6 ? 'IPv6' : '未评分', 9, null, 'medium')),
        spacer(),
      ],
    }],
  };
}

function rectangularWidget(m) {
  const kinds = traits(m).map(t => t.short).join(' ');
  return {
    type: 'widget',
    gap: 1,
    url: SITE_URL,
    refreshAfter: refreshAt(m.refreshMinutes),
    children: [
      row([T(m.flag, 12), T([m.country, m.city].filter(Boolean).join(' '), 13, null, 'semibold', { minScale: 0.6 })], { gap: 4 }),
      row([
        T(m.score === null ? '—' : String(Math.round(m.score)), 17, null, 'bold'),
        T(m.band ? m.band.short : m.isV6 ? 'IPv6 不评分' : '暂无评分', 12, null, 'semibold'),
      ], { gap: 4 }),
      T(kinds || m.shownIP, 12, null, 'regular', { minScale: 0.6 }),
    ],
  };
}

function inlineWidget(m) {
  const score = m.score === null ? '' : `${Math.round(m.score)} ${m.band.short}`;
  const text = [m.flag, score || (m.isV6 ? 'IPv6 不评分' : '暂无评分'), ...traits(m).map(t => t.short)].join(' ');
  return { type: 'widget', url: SITE_URL, refreshAfter: refreshAt(m.refreshMinutes), children: [T(text, 12, null)] };
}

// ───────────────────────────── 出错 ─────────────────────────────

function errorWidget(family, cfg, err) {
  const refreshAfter = refreshAt(Math.min(cfg.refreshMinutes, 10));
  const base = { type: 'widget', url: SITE_URL, refreshAfter };
  if (family === 'accessoryInline') return { ...base, children: [T(err.title, 12, null)] };
  if (family === 'accessoryCircular') {
    return { ...base, padding: 0, children: [spacer(), center(icon('exclamationmark.triangle', 22, null)), spacer()] };
  }
  if (family === 'accessoryRectangular') {
    return { ...base, gap: 2, children: [T('IP 纯净度', 13, null, 'semibold'), T(err.title, 12, null, 'regular', { maxLines: 2, minScale: 0.7 })] };
  }
  return {
    ...base,
    backgroundColor: C.bg,
    padding: 14,
    gap: 6,
    children: [
      row([icon('exclamationmark.triangle.fill', 13, C.warn), T(err.title, 14, C.ink, 'semibold', { minScale: 0.7 })], { gap: 6 }),
      T(err.hint, 11, C.soft, 'regular', { maxLines: family === 'systemSmall' ? 5 : 3, minScale: 0.8 }),
      spacer(),
      row([T(cfg.label || cfg.policy || 'IP 纯净度', 10, C.faint, 'medium'), spacer(), T(clock(), 10, C.faint, 'medium')]),
    ],
  };
}
