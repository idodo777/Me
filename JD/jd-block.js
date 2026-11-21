/* 京东拦截 · 请求阶段直接返回空 JSON（Egern ctx 版）
 * 用 http_request + ctx.respond() 在请求发出前就回空响应，不经过服务器。
 * 与 map_locals 的区别：这是脚本层拦截，走另一条执行路径；
 * 针对京东全是 POST + 加密 body 的情况，map_locals 可能拦不住 POST。
 * 只拦推荐/广告类接口，正常接口直接放行（返回 undefined）。
 */

export default async function (ctx) {
  return ctx.respond({
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
}
