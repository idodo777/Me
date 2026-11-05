/*
 * ============================================================
 * 京东比价（Egern 版）
 * ============================================================
 * 原作者：WeiGiegie（bijia.js，数据源 w.so168.top 历史价格）
 * 原版地址：https://raw.githubusercontent.com/WeiGiegie/666/main/bijia.js
 * 分发插件：kelvinlab JD_remove_ads.lpx
 *
 * 作用：在京东商品详情页（in.m.jd.com/product/graphext/<id>.html）
 * 的 <body> 后注入历史价格表（当前价/历史最低/30/90/180/365 天最低/618/双11/双12）。
 *
 * 本文件为 Egern 移植：原版的 Env 工具类 + $httpClient 已换成 ctx.http，
 * 价格解析与 HTML 生成与原版逐字一致；出错时与原版一样在页面顶部显示
 * 红色提示框并发送通知，外层异常一律放行原页面。
 * ============================================================
 */

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.61(0x18003d39) NetType/WIFI Language/zh_CN";

// 用 ctx.http 发请求，并按原版 httpRequest 的语义解析：
// body 是 JSON 就返回对象；含“对不起，没有找到”时返回原文字符串。
async function httpJson(ctx, method, url, headers, body) {

    const options = { headers: headers, timeout: 8000 };
    if (body !== undefined) options.body = body;

    const res = method === "POST"
        ? await ctx.http.post(url, options)
        : await ctx.http.get(url, options);

    const text = await res.text();

    if (typeof text === "string" && text.includes("对不起，没有找到")) {
        return text;
    }

    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
}

async function main(ctx, responseBody) {

    const url = ctx.request.url;

    const match = url.match(/product\/graphext\/(\d+)\.html/);
    if (!match) throw new Error("商品ID获取失败");

    const productId = match[1];
    const JD_Url = `https://item.jd.com/${productId}.html`;

    // 获取商品加密code
    const codeRes = await httpJson(ctx, "POST",
        "https://w.so168.top/getClickUrlById.do",
        {
            "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
            "User-Agent": UA,
            "Accept-Encoding": "gzip,compress,br,deflate",
            "Connection": "keep-alive"
        },
        `scontent=${encodeURIComponent(JD_Url)}`
    );

    if (!codeRes?.code) throw new Error("商品数据获取失败");

    // 获取历史价格数据
    const historyRes = await httpJson(ctx, "GET",
        `https://w.so168.top/history.htm?code=${encodeURIComponent(codeRes.code)}&reType=json`,
        {
            "User-Agent": UA,
            "Accept-Encoding": "gzip,compress,br,deflate",
            "Connection": "keep-alive"
        }
    );

    if (typeof historyRes === "string" && historyRes.includes("对不起，没有找到")) {
        throw new Error("该商品暂未收录价格数据");
    }

    if (!historyRes?.his) throw new Error("未获取到历史价格信息");

    // 解析历史数据
    const priceList = parseHistoryData(historyRes.his, historyRes.minPrice);
    if (!priceList.length) throw new Error("价格数据解析失败");

    // 生成HTML
    const html = generateHTML(priceList);
    return responseBody.replace("<body>", `<body>${html}`);
}

function parseHistoryData(historyStr, minPrice) {
    const priceList = [];
    const now = new Date();

    // 解析历史数据
    const regex = /Date\.UTC\((\d{4}),(\d{1,2}),(\d{1,2})\),(\d+(?:\.\d+)?)/g;
    const matches = [...historyStr.matchAll(regex)];
    if (!matches.length) return [];

    const prices = matches.map(match => {
        const year = parseInt(match[1]);
        const month = parseInt(match[2]);
        const day = parseInt(match[3]);
        const price = parseFloat(match[4]);
        return { date: new Date(Date.UTC(year, month, day)), price, month: month + 1, day };
    });

    prices.sort((a, b) => a.date - b.date);

    const currentPrice = prices[prices.length - 1].price;
    const currentDate = prices[prices.length - 1].date;

    // 关键价格点
    const pricePoints = [
        { name: '当前到手价', getValue: () => currentPrice, getDate: () => currentDate, isCurrent: true },
        { name: '历史最低价', getValue: () => minPrice, getDate: () => prices.find(p => p.price === minPrice)?.date },
        { name: '30天最低价', getValue: () => getMinPrice(prices, 30, now), getDate: () => getMinDate(prices, 30, now) },
        { name: '90天最低价', getValue: () => getMinPrice(prices, 90, now), getDate: () => getMinDate(prices, 90, now) },
        { name: '180天最低价', getValue: () => getMinPrice(prices, 180, now), getDate: () => getMinDate(prices, 180, now) },
        { name: '365天最低价', getValue: () => getMinPrice(prices, 365, now), getDate: () => getMinDate(prices, 365, now) },
        { name: '618价格', getValue: () => getSpecialPrice(prices, 6, 18), getDate: () => getSpecialDate(prices, 6, 18) },
        { name: '双11价格', getValue: () => getSpecialPrice(prices, 11, 11), getDate: () => getSpecialDate(prices, 11, 11) },
        { name: '双12价格', getValue: () => getSpecialPrice(prices, 12, 12), getDate: () => getSpecialDate(prices, 12, 12) }
    ];

    let sortOrder = 1;
    pricePoints.forEach(point => {
        const value = point.getValue();
        const date = point.getDate();
        if (value !== null && value !== undefined) {
            priceList.push({
                Name: point.name,
                Date: date ? formatDate(date) : '',
                Price: value.toFixed(2),
                Difference: point.isCurrent ? '当前' : formatDifference(currentPrice, value),
                Percentage: point.isCurrent ? '-' : formatPercentage(currentPrice, value),
                sortOrder: sortOrder++
            });
        }
    });

    priceList.sort((a, b) => a.sortOrder - b.sortOrder);
    return priceList;
}

// 辅助函数
function getMinPrice(prices, days, now) {
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    const filtered = prices.filter(p => p.date >= cutoff);
    return filtered.length > 0 ? Math.min(...filtered.map(p => p.price)) : null;
}

function getMinDate(prices, days, now) {
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    const filtered = prices.filter(p => p.date >= cutoff);
    if (filtered.length === 0) return null;
    const minPrice = Math.min(...filtered.map(p => p.price));
    return filtered.find(p => p.price === minPrice)?.date;
}

function getSpecialPrice(prices, month, day) {
    const filtered = prices.filter(p => p.month === month && p.day === day);
    return filtered.length > 0 ? filtered.sort((a, b) => b.date - a.date)[0].price : null;
}

function getSpecialDate(prices, month, day) {
    const filtered = prices.filter(p => p.month === month && p.day === day);
    return filtered.length > 0 ? filtered.sort((a, b) => b.date - a.date)[0].date : null;
}

function formatDate(date) {
    if (!date) return '-';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDifference(current, history) {
    const diff = current - history;
    const absDiff = Math.abs(diff);
    if (diff === 0) return '持平';
    return diff > 0 ? `↑${absDiff.toFixed(2)}` : `↓${absDiff.toFixed(2)}`;
}

function formatPercentage(current, history) {
    const diff = current - history;
    if (diff === 0) return '0%';
    const percent = (Math.abs(diff) / current * 100).toFixed(1);
    return diff > 0 ? `↑${percent}%` : `↓${percent}%`;
}

function generateHTML(priceList) {
    // 生成表格行
    const rows = priceList.map(item => {
        const { Name: name, Date: date, Price: price, Difference: diff, Percentage: percent } = item;
        const isCurrent = name === '当前到手价';

        let diffClass = '', percentClass = '';
        if (diff.startsWith('↑')) diffClass = percentClass = 'up';
        else if (diff.startsWith('↓')) diffClass = percentClass = 'down';

        if (isCurrent) {
            return `<tr class="current-row">
                <td><strong>${name}</strong></td>
                <td>${date}</td>
                <td><strong>${price}</strong></td>
                <td><strong>${diff}</strong></td>
                <td>-</td>
            </tr>`;
        }

        return `<tr>
            <td>${name}</td>
            <td>${date}</td>
            <td>${price}</td>
            <td class="${diffClass}">${diff}</td>
            <td class="${percentClass}">${percent}</td>
        </tr>`;
    }).join('');

    const now = new Date();
    const updateTime = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')}`;

    return `<div class="price-container">
        <table class="price-table">
            <thead>
                <tr>
                    <th>类型</th>
                    <th>日期</th>
                    <th>价格</th>
                    <th>差价</th>
                    <th>幅度</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <div class="footer">
            <span>更新: ${updateTime}</span>
        </div>
    </div>
    <style>
        body, table {
            font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
            margin: 0;
            padding: 0;
        }
        .price-container {
            max-width: 95%;
            margin: 8px auto;
            padding: 8px;
            background: #fff;
            border-radius: 6px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.08);
            border: 1px solid #e0e0e0;
            font-size: 12px;
        }
        .price-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 6px;
            table-layout: fixed;
        }
        .price-table th {
            background: #f8f8f8;
            color: #333;
            padding: 8px 4px;
            text-align: left;
            font-weight: bold;
            border-bottom: 1px solid #e61a23;
            font-size: 11px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .price-table td {
            padding: 6px 4px;
            border-bottom: 1px solid #f0f0f0;
            font-size: 11px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .current-row {
            background-color: #fff5f5;
        }
        .current-row td {
            font-weight: bold;
            border-bottom: 1px solid #e61a23;
        }
        .up {
            color: #C91623;
            font-weight: bold;
        }
        .down {
            color: #00aa00;
            font-weight: bold;
        }
        .price-table tbody tr:nth-child(even):not(.current-row) {
            background-color: #fafafa;
        }
        .price-table tbody tr:hover {
            background-color: #f0f7ff;
        }
        .footer {
            font-size: 10px;
            color: #999;
            padding-top: 6px;
            border-top: 1px dashed #eee;
            text-align: right;
        }
        /* 列宽分配 */
        .price-table th:nth-child(1),
        .price-table td:nth-child(1) {
            width: 22%;
        }
        .price-table th:nth-child(2),
        .price-table td:nth-child(2) {
            width: 20%;
        }
        .price-table th:nth-child(3),
        .price-table td:nth-child(3) {
            width: 18%;
            text-align: right;
        }
        .price-table th:nth-child(4),
        .price-table td:nth-child(4) {
            width: 15%;
            text-align: center;
        }
        .price-table th:nth-child(5),
        .price-table td:nth-child(5) {
            width: 15%;
            text-align: center;
        }
        /* 价格列右对齐，其他列左对齐 */
        .price-table th:nth-child(3),
        .price-table td:nth-child(3) {
            text-align: right;
            padding-right: 6px;
        }
        .price-table th:nth-child(4),
        .price-table td:nth-child(4),
        .price-table th:nth-child(5),
        .price-table td:nth-child(5) {
            text-align: center;
        }
        /* 表头文字更紧凑 */
        .price-table th {
            letter-spacing: -0.3px;
        }
    </style>`;
}

export default async function (ctx) {

    const responseBody = await ctx.response.text().catch(() => null);

    if (responseBody === null || !ctx.request.url.includes("/product/graphext/")) {
        return;
    }

    try {

        const newBody = await main(ctx, responseBody);
        if (newBody) return { body: newBody };
        return;

    } catch (err) {

        // 与原版一致：页面顶部显示红色提示框 + 发通知
        const html = `<div style="max-width:90%;margin:20px auto;padding:12px;background:#fff;color:#d32f2f;border:2px solid #f44336;border-radius:8px;font-size:14px;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,0.06);"><strong>${err.message || '未知错误'}</strong></div>`;

        try {
            await ctx.notify({ title: "京东比价提示", body: err.message || '未知错误' });
        } catch (e) {}

        return { body: responseBody.replace("<body>", `<body>${html}`) };

    }
}
