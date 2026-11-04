// 萤石云视频 · 广告关闭（Egern http_response 脚本）
// 收紧版（2026-11-04）：只做两个精确动作，不做任何字段名猜测式清洗，
// 把对正常功能的影响面降到最小。其余响应一律原样放行（fail-open）。
//   1) 广告总开关：adYsFlag / adThirdFlag 置 0
//      （实测自广告 SDK 配置响应：adYsFlag=萤石自有广告，adThirdFlag=第三方广告；
//       置 0 = 让 App 用自己的开关关掉广告）
//   2) 广告数组清空：整条响应命中广告结构签名时返回 []
//      （实测样本：ecapi-flood.ys7.com /v1/ad/icons 的商城「半价」角标，
//       条目形如 {name:"半价", place:3, ad_type:1, materiel:{...}, img:".../mall/*.png"}）

const AD_FLAG_KEYS = ['adYsFlag', 'adThirdFlag'];

// 只查找并翻转两个精确字段名，不碰任何其它字段
function flipFlags(node, depth) {
  if (depth > 12 || node === null || typeof node !== 'object') return false;
  let changed = false;
  if (Array.isArray(node)) {
    for (const item of node) if (flipFlags(item, depth + 1)) changed = true;
    return changed;
  }
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (AD_FLAG_KEYS.indexOf(key) >= 0) {
      if (val === 1 || val === true || val === '1') { node[key] = 0; changed = true; }
      continue;
    }
    if (flipFlags(val, depth + 1)) changed = true;
  }
  return changed;
}

// 广告数组的结构签名：每个条目都带 ad_type + materiel/img 素材字段
function isAdArray(data) {
  return Array.isArray(data) && data.length > 0 && data.every(it =>
    it && typeof it === 'object' && !Array.isArray(it) &&
    'ad_type' in it && ('materiel' in it || 'img' in it));
}

export default async function (ctx) {
  try {
    const data = await ctx.response.json();
    if (!data || typeof data !== 'object') return;
    if (isAdArray(data)) return { body: [] };
    if (flipFlags(data, 0)) return { body: data };
  } catch (e) {
    // 非 JSON 或解析失败：原样放行
    return;
  }
}
