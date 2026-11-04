// 萤石云视频 · 隐藏「对话」Tab（Egern http_response 脚本）
// 收紧版（2026-11-04）：只做一个精确动作——灰度开关手术。
// 实测自 /v3/configurations/gray/info 的 grayConfigInfos：
//   300045 = 是否支持会话 tab 展示（即「对话」Tab），"1" 支持 / "0" 不支持。
// 把它置 "0"（保持原值类型）即让 App 按官方开关隐藏对话 Tab。
// 商城/社区 Tab 经全量抓包核查为客户端写死、无服务端开关，本脚本不处理。
// 不认识的结构一律放行（fail-open）。

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
    if (patchGray(data)) return { body: data };
  } catch (e) {
    return;
  }
}
