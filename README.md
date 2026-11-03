# 优衣库中国大陆优惠追踪

**[逛男装](https://lucashood008.github.io/uniqlo-cn-sale-site/)　·　[逛女装](https://lucashood008.github.io/uniqlo-cn-sale-site/?channel=women)**

每天整理优衣库中国大陆官网「限时特优」和「超值精选」。网页挑出比初上市价便宜 **40% 及以上** 的款式，可以直接逛折扣榜，也可以搜货号，看同一款衣服最近有没有继续降价。男女同款按官网归类和适穿标签收录在相应频道，童装和婴幼儿装不在收录范围。

| 想做什么 | 男装 | 女装 |
| --- | --- | --- |
| 看最近一批有哪些降价、首次发现或重新出现的款式 | [本次变化](https://lucashood008.github.io/uniqlo-cn-sale-site/#deal-changes) | [本次变化](https://lucashood008.github.io/uniqlo-cn-sale-site/?channel=women#deal-changes) |
| 浏览优惠幅度最高的 12 款 | [高折扣榜](https://lucashood008.github.io/uniqlo-cn-sale-site/#highlights-title) | [高折扣榜](https://lucashood008.github.io/uniqlo-cn-sale-site/?channel=women#highlights-title) |
| 查指定商品，按活动、最低优惠或预算筛选 | [搜索与筛选](https://lucashood008.github.io/uniqlo-cn-sale-site/#filters) | [搜索与筛选](https://lucashood008.github.io/uniqlo-cn-sale-site/?channel=women#filters) |

**怎么读一个价格。** 货号 `489492` 的衬衫式棉服，初上市价为 499 元。2026-10-29 13:43 采集到 399 元，2026-11-03 20:32 在同一官网页面采集到 299 元。后一次在折扣榜按 **省 40.1%** 排名，在「本次变化」记为**比上次便宜 100 元**。这两项分别回答“折扣有多大”和“这次便宜了多少”。以上时间均为北京时间。[查看这款棉服的观测记录](https://lucashood008.github.io/uniqlo-cn-sale-site/?product=489492&offer=u0000000076220)

点商品可看价格记录、复制货号，或打开对应的优衣库官网页面核对颜色、尺码和库存。收藏保存在当前浏览器。分享商品或筛选条件时，接收者打开链接会按最新发布的数据重新计算。支持添加到主屏幕。离线时可回看已缓存的页面和数据，以页面标注的采集时间为准。

## 数据怎么看

- **优惠幅度与预算**。优惠幅度按「（初上市价 − 当前最低价）÷ 初上市价」计算。官网报价有区间时，页面显示区间，预算按区间下限筛选。缺少计算所需价格的记录保留在完整数据中。折扣榜依次按优惠幅度、优惠金额降序排列，仍相同则按货号排序。
- **一款与一条记录**。一款按货号计，同一货号可以有多个官网页面。一条记录对应一个官网内部商品编码。同一编码出现在两个活动时合并活动标签，不同编码的报价分别保留。筛选时，活动、优惠幅度和预算须落在同一条报价上。男女同款可同时进入两个频道，两个频道的款数不能直接相加作为全站去重款数。
- **变化与低价**。「进一步降价」比较同一官网页面的两次成功采集。「首次发现」指本项目在该频道首次识别到该款，「重新出现」指曾有记录、上一批未见、本批再次出现。两批采集可能相隔数日。同日重复采集相同数据时保留上一次有效变化。近 30 日或 90 日低价只覆盖项目实际观测到的日期。「本次未检出」仅表示这次优惠列表未返回该记录，库存以官网为准。

### 报告与下载

| 内容 | 男装 | 女装 |
| --- | --- | --- |
| Markdown 特惠清单，含折扣分区与汇总 | [查看清单](LATEST.md) | [查看清单](women/LATEST.md) |
| 全部收录报价，包含不足 40% 的记录 | [CSV](latest.csv) | [CSV](women/latest.csv) |
| 按官网入口比较新增、降价、涨价及本次未检出 | [查看报告](reports/changes.md) | [查看报告](reports/women/changes.md) |
| 供程序读取的最新快照及近 90 天观测价 | [最新快照](data/latest.json) · [历史记录](data/price_history.json) | [最新快照](data/women/latest.json) · [历史记录](data/women/price_history.json) |

男装延续原有价格历史。女装从首批成功采集建立变化基线；男女同款只有在官网内部商品编码一致、且确有历史报价时，才沿用此前的观测价。

本项目独立维护，与优衣库无隶属或合作关系。
