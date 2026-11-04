// 萤石云视频 · 开屏广告清洗（Egern http_response 脚本）
// 思路（借鉴 txvideo 模块的 fail-open 纪律）：
//   只在广告类接口的响应上动手，把广告容器字段清空，保留响应信封结构；
//   任何解析失败 / 结构不认识，一律原样放行，绝不弄坏 App。
// 已知开屏广告接口：https://i.ys7.com/api/ads（模块里另有 reject-dict 兜底，
// 本脚本负责该接口改名/变体以及其它 splash/launch 类接口的响应清洗）。

const AD_KEY_RE = /^(ads?|adlist|advert\w*|splash\w*|launch\w*|openscreen|startup\w*|promot\w*|adinfo|adconfig|admaterial\w*)$/i;

function scrub(node, depth) {
  if (depth > 12 || node === null || typeof node !== 'object') return false;
  let changed = false;
  if (Array.isArray(node)) {
    for (const item of node) if (scrub(item, depth + 1)) changed = true;
    return changed;
  }
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (AD_KEY_RE.test(key)) {
      if (Array.isArray(val) && val.length) { node[key] = []; changed = true; }
      else if (val && typeof val === 'object' && Object.keys(val).length) { node[key] = {}; changed = true; }
      else if (typeof val === 'string' && val) { node[key] = ''; changed = true; }
      else if (typeof val === 'number' && val) { node[key] = 0; changed = true; }
      continue;
    }
    if (scrub(val, depth + 1)) changed = true;
  }
  return changed;
}

// 广告数组的结构签名：条目带 ad_type + materiel/img 素材字段
// （实测样本：商城 Tab 的「半价」角标广告 —— [{name:"半价", place:3, ad_type:1, materiel:{...}, img:".../mall/*.png"}]）
function isAdArray(data) {
  return Array.isArray(data) && data.length > 0 && data.every(it =>
    it && typeof it === 'object' && !Array.isArray(it) &&
    'ad_type' in it && ('materiel' in it || 'img' in it));
}

export default async function (ctx) {
  try {
    const data = await ctx.response.json();
    if (!data || typeof data !== 'object') return;

    // 整条响应就是广告数组（如角标/横幅广告位）：直接清空
    if (isAdArray(data)) return { body: [] };

    // 若整个 data 载荷就是广告（如只有广告素材字段），直接掏空 data
    let changed = scrub(data, 0);

    // 兜底：data 下若有形如 { list: [...广告...], img/url 素材 } 的开屏结构，
    // scrub 已按字段名处理；这里再处理“根节点即广告对象”的情况：
    // 根对象带素材直链字段（imageUrl/videoUrl/jumpUrl 等）且无其它业务字段时视为空广告
    const keys = Object.keys(data);
    const materialKeys = keys.filter(k => /(img|image|video|jump|click|landing)/i.test(k) && /(url|link)/i.test(k));
    if (!changed && materialKeys.length && keys.length <= materialKeys.length + 3) {
      for (const k of materialKeys) data[k] = '';
      changed = true;
    }

    if (changed) return { body: data };
  } catch (e) {
    // 非 JSON 或解析失败：原样放行
    return;
  }
}
