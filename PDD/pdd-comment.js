// 拼多多评价页精简（Egern）
// 移植自 Yi-r8 的 pinduoduo.js 中 comment_result 分支（原脚本另有 hub 与取件页分支，
// 与本模块的声明式改写和扫码取件脚本重复，未并入）：
// 注入 CSS 隐藏评价页的推荐商品容器与下载引导，并把 has_more 改为 false，阻止翻页继续加载推荐。
// 任何异常都原样放行。
export default async function (ctx) {
  try {
    let body = await ctx.response.text();
    if (/^\s*<!DOCTYPE html>/i.test(body)) {
      const hideCSS = `
      <style>
        /* 隐藏推荐商品容器 */
        #recommend-wrapper,
        #downloader-container {
          display: none !important;
          height: 0 !important;
          overflow: hidden !important;
        }
      </style>
    </head>
    `;
      body = body.replace("</head>", hideCSS);
      if (body.includes('"has_more":true')) {
        body = body.replace('"has_more":true', '"has_more":false');
      }
    }
    return { body };
  } catch (e) {
    return;
  }
}
