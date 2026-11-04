// 萤石云视频 · 底部 Tab 精简（Egern http_response 脚本）
// 目标：去掉底部栏的「对话」「商城」「社区」三个 Tab，保留「萤石」「我的」等。
// 思路（借鉴 txvideo 的 tabFix）：
//   底部栏由服务端配置下发（JSON 数组）。本脚本在所有 ys7 的 JSON 响应里
//   寻找“长得像 Tab 栏”的数组：条目带标题字段、且同时出现要删的 Tab 和
//   要留的 Tab 时才动手；删完后把排序字段重新编号，避免客户端排序错乱。
//   不认识的结构一律放行（fail-open）。

const DROP_TITLES = ['对话', '商城', '社区'];
const KEEP_TITLES = ['萤石', '首页', '主页', '我的', '设备', '消息'];
const DROP_KEY_RE = /(^|[_-])(chat|talk|mall|shop|store|community|bbs|forum|shequ|duihua|shangcheng)([_-]|$)/i;

const TITLE_FIELDS = ['title', 'name', 'text', 'label', 'tabName', 'tabTitle'];
const KEY_FIELDS = ['code', 'key', 'type', 'tabKey', 'module', 'page', 'pageId', 'id'];
const ORDER_FIELDS = ['sort', 'order', 'index', 'seq', 'tabIndex', 'position', 'sortNum', 'orderNum'];

function fieldOf(item, fields) {
  for (const f of fields) {
    const v = item[f];
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

function isDropItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const title = fieldOf(item, TITLE_FIELDS);
  if (title && DROP_TITLES.indexOf(title.trim()) >= 0) return true;
  const key = fieldOf(item, KEY_FIELDS);
  if (key && DROP_KEY_RE.test(key)) return true;
  return false;
}

function looksLikeTabBar(arr) {
  if (!Array.isArray(arr) || arr.length < 3 || arr.length > 10) return false;
  let hasDrop = false, hasKeep = false;
  for (const item of arr) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const title = fieldOf(item, TITLE_FIELDS);
    if (!title && !fieldOf(item, KEY_FIELDS)) return false;
    if (isDropItem(item)) hasDrop = true;
    if (title && KEEP_TITLES.indexOf(title.trim()) >= 0) hasKeep = true;
  }
  return hasDrop && hasKeep;
}

function renumber(items) {
  for (const f of ORDER_FIELDS) {
    if (items.length && items.every(it => typeof it[f] === 'number')) {
      const base = Math.min.apply(null, items.map(it => it[f])) === 1 ? 1 : 0;
      items.forEach((it, i) => { it[f] = i + base; });
      return;
    }
  }
}

function clean(node, depth) {
  if (depth > 14 || node === null || typeof node !== 'object') return false;
  let changed = false;
  if (Array.isArray(node)) {
    if (looksLikeTabBar(node)) {
      const kept = node.filter(it => !isDropItem(it));
      if (kept.length !== node.length) {
        renumber(kept);
        node.length = 0;
        for (const it of kept) node.push(it);
        changed = true;
      }
    }
    for (const item of node) if (clean(item, depth + 1)) changed = true;
    return changed;
  }
  for (const key of Object.keys(node)) {
    if (clean(node[key], depth + 1)) changed = true;
  }
  return changed;
}

// 灰度开关手术（实测自 /v3/configurations/gray/info 的 grayConfigInfos）：
// 按灰度 ID 关闭目标 Tab 的开关，switchStatus 保持原值类型（字符串 "1" → "0"）。
//   300045 = 是否支持会话 tab 展示（即「对话」Tab），0 = 不支持
const GRAY_OFF_IDS = ['300045'];

function patchGray(data) {
  const infos = data && typeof data === 'object' ? data.grayConfigInfos : null;
  if (!infos || typeof infos !== 'object') return false;
  let changed = false;
  for (const id of GRAY_OFF_IDS) {
    const item = infos[id];
    if (item && typeof item === 'object' && 'switchStatus' in item) {
      const off = typeof item.switchStatus === 'string' ? '0' : 0;
      if (item.switchStatus !== off) { item.switchStatus = off; changed = true; }
    }
  }
  return changed;
}

export default async function (ctx) {
  try {
    const data = await ctx.response.json();
    if (!data || typeof data !== 'object') return;
    const g = patchGray(data);
    const c = clean(data, 0);
    if (g || c) return { body: data };
  } catch (e) {
    return;
  }
}
