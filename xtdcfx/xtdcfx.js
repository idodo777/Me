/*
 * 系统电池分析 — 解锁会员（Egern 版）
 * 转自 chxm1023/Rewrite 的 xtdcfx.js（作者 @ddm1023），按 Egern ctx API 移植
 * 作用：改写 /vip/storekit/purchases/sync 的响应，把会员字段置为已开通
 * 与原版的唯一差异：响应异常（无 data、非 JSON）时原样放行，不让脚本报错
 */

const PATCH = {
  "member": true,
  "adFree": true,
  "entitlementStatus": "ACTIVE",
  "risk": "LOW",
  "action": "ALLOW",
  "serverVerifiedUntil": "2099-09-09T09:09:09Z",
  "vip": true,
  "expiresAt": "2099-09-09T09:09:09Z",
  "privileges": [
    "member",
    "vip",
    "ad_free"
  ],
  "offlineGraceUntil": "2099-09-09T09:09:09Z",
  "signedEntitlementToken": "TEST_SIGNED_ENTITLEMENT_TOKEN"
};

export default async function (ctx) {
  try {
    // 不要用 ctx.response.json()：实测在 Egern 中会抛 pattern SyntaxError。
    let ddm = null;
    try { const t = await ctx.response.text(); ddm = t ? JSON.parse(t) : null; } catch (e) { ddm = null; }
    if (ddm == null) { try { const b = await ctx.response.arrayBuffer(); ddm = JSON.parse(new TextDecoder('utf-8').decode(b)); } catch (e) { ddm = null; } }
    if (!ddm || typeof ddm !== "object" || !ddm.data || typeof ddm.data !== "object") return {};
    Object.assign(ddm.data, PATCH);
    return { body: JSON.stringify(ddm) };
  } catch (e) {
    return {};
  }
}
