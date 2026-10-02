# Token Counter

[English](README.md) | 中文

一个 DeepSeek Harness（DSH）插件：显示**账户余额**，并在每轮对话结束后显示该轮的 **Token 消耗量**与**本次花费**。本插件由 **DeepSeek-V4.1-Flash** 在**最高推理强度（max）**下编写。

## 显示内容

| 位置 | 内容 |
| --- | --- |
| `conversation.input.left`（输入框工具栏常驻） | 余额徽标——余额唯一出现的地方：`余额 ¥3.24`。按界面语言对应的币种，把账户持有的钱包相加后原样显示。每分钟、以及每轮对话结束后各刷新一次。 |
| `conversation.chat.turnTail`（回合结束页脚） | 每轮用量与花费，不含余额，固定三行——用量、花费、输入/输出明细。 |

两处的**每一个数字和每一条文案**都跟随界面语言：费用的价目表与文案、余额的币种。在 DSH 里切换语言会立刻重渲染两者，不需要额外的网络请求，已经显示在屏幕上的历史轮次也会一起变。

中文界面下，一轮空闲时段的 `deepseek-flash` 读数：

```
本轮 Token 1.23M · 输入 1.20M · 输出 30.0K · 缓存命中 1.10M
本次花费 ¥0.2420 优惠时段
输入 ¥0.1220（命中 ¥0.0220 · 未命中 ¥0.1000） · 输出 ¥0.1200
```

同一轮在英文界面下：

```
Turn tokens 1.23M · in 1.20M · out 30.0K · cache hit 1.10M
Cost $0.0363 off-peak
in $0.0183 (hit $0.0033 · miss $0.0150) · out $0.0180
```

它是纵向排列，所以无论面板多宽，这三段各占一行；每段是 `white-space: nowrap`，自身不会被拆行。两个条目在无内容可显示时都返回 `null`——这就是列表条目放弃座位的方式。

### 示例可以验算

空闲时段 `deepseek-flash` 的人民币价（命中 ¥0.02、未命中 ¥1、输出 ¥4 每百万）：1.10M 命中输入花 ¥0.0220，0.10M 未命中输入花 ¥0.1000——合计 ¥0.1220——30.0K 输出花 ¥0.1200，本轮总计 ¥0.2420。输入 1.20M 就是命中与未命中两部分之和。

## 工作原理

* **Token 用量不做二次推算。** 内置的 Conversation 已经把每一轮的用量折算进 `turn-tail` 位置数据；本插件直接读 `props.turn.data.get('turn-tail').tokenUsage`，它带有 `uncachedInputTokens`、`outputTokens`、`totalTokens`、`cacheReadTokens?`、`cacheWriteTokens?`、`reasoningTokens?` 和 `routes?`。
* **花费**由该用量和 `lib/client.js` 里的价目表算出，按 DeepSeek 实际计费的三个桶拆分：**命中**（缓存读取的输入，按命中价）、**未命中**（未命中输入加缓存写入，按未命中价）、**输出**（生成的 token，按输出价）。三个数字相加等于它上面那个总额；读数把两个输入桶合并成一个 `输入` 数字，命中/未命中的拆分放在括号里。跨多个路由的回合（重试、切模型）会把 token 均摊到各路由，这对正常的单路由回合是精确的。
* **余额**通过 Web Client 已经挂载的账户 Remote 读取（`remote.account.getBalance({ version, locale, timezoneOffsetSeconds })`），返回 `{ ok, value }`，其中 `value` 是 `null`、`{ status: 'ready', value: AccountWallet[], bonusWallets }` 或 `{ status: 'failed' }`。该命名空间不存在时，插件退回原始的 `connection.rpc.call('/api', 'account/getBalance', { args: { client } })` 通道。硬依赖只有 `slots`，所以账户不可用时，Token 与花费读数照常渲染。

### 界面语言决定什么

**界面语言**决定三件事，两处都适用：

| 界面语言 | 价目表 | 显示币种 | 文案 |
| --- | --- | --- | --- |
| `zh*` | `PRICES.CNY` | `CNY` | `DICTS.zh` |
| 其它 | `PRICES.USD` | `USD` | `DICTS.en` |

两张价目表的出处：<https://api-docs.deepseek.com/zh-cn/quick_start/pricing/> 与 <https://api-docs.deepseek.com/quick_start/pricing/>。

插件订阅了客户端的 `locale` 服务，所以在 DSH 里切换语言会立刻重新标注文案、重新选择价目表、并在账户已经持有的钱包里重新选择——全部即时生效，且包含已经显示在屏幕上的历史轮次。locale 读的是**同一个**为账户 Remote 提供 `locale` 字段的服务，没有额外接线。

文案**没有**注册到 DSH 的 locale 注册表：字典就在这个 bundle 里，由驱动币种切换的同一个 locale 信号来选择。这是刻意的取舍——复用一条已被验证的代码路径，而不是新增对框架翻译座位的依赖；代价是别的插件无法复用这份字典。如果你更想用原生机制，用 `ctx.locale.register` 注册一个命名空间，并在那两处 `ctx.slots.register` 上声明 `locale: <ns>`，框架就会把 `t` 座位挂到组件 props 上。

### 哪里换算、哪里不换算

哪里都不换算。这正是内置两张价目表的意义。

**费用**用的是语言选中的那张表——一份真实的官方价目，所以显示的数字和计费的依据之间没有任何汇率假设。

**余额**同样不需要换算——前提是两个钱包列表都读对了。`getBalance` 返回**两个**列表：`value`（充值余额）和 `bonusWallets`（赠送余额），而 DeepSeek 两个都扣、优先扣赠送。所以某个币种的可用余额是两者之和，插件选择界面语言对应的那个币种。徽标的悬停提示会显示这个拆分（`充值 ¥0.00 · 赠送 ¥3.24`）——这也正是本插件唯一那个真实 bug 被发现的方式：早先的版本只读 `value` 且只取第一个元素，于是一个充值余额已耗尽、赠送余额还有钱的账户会显示成 `¥0.00`。

如果账户不持有界面语言对应币种的钱包，插件就显示它实际持有的币种，而不是自己编一个汇率。此时费用和余额币种不同、无法相减——这是诚实的结局。

## 配色

两处读数同一字号，靠**颜色**而不是透明度或字重来区分角色：

* `.dsh-tc-label` —— 标签、分隔符、括注、括号。中性色：黑色，在 `body[data-ds-dark-theme]` 下翻白，字重 400。
* `.dsh-tc-count` —— Token 计数及其 `K`/`M` 后缀。同样中性色（字重 500），这样 DSH 本来就会显示的那四个用量条目在视觉上和金额分开，绿色就留给"花了多少钱"。
* `.dsh-tc-value` —— 金额数字及其货币符号。主题的成功色绿（`--dsw-alias-success`，兜底 `#22c55e`），字重 500。
* `.dsh-tc-period` —— 高峰/空闲时段标记，用主题的链接蓝（`--dsw-alias-link`，兜底 `#4d6bfe`）。

把中性文本和金额按颜色分开是刻意的：中文和西文字面并不共享同一字重，用同一种颜色会让这个差异看起来像做错了。两个容器都钉死了基准字重，所以读数不会从挂载的座位上继承到别的字重。

## 配置

浏览器半是冻结产物——Loader 行的 `config` 只送达宿主半——所以可调项以具名常量的形式放在 **`lib/client.js`** 顶部：

| 常量 | 含义 |
| --- | --- |
| `DICTS` | 界面文案，每种界面语言一份字典（`zh`、`en`），由 `labelsFor` 选择。 |
| `PRICES` | 官方每百万 token 价，**按币种分表**（`CNY`、`USD`），每张表里 `routes` 按 `provider/model` 索引，另有 `default`。数值取该币种页面的**空闲时段**列。 |
| `FALLBACK_CURRENCY` | 界面语言不是中文（或未知）时使用的币种。 |
| `PEAK` | 高峰时段（北京时间周一至周五 09:00–12:00 与 14:00–18:00）按 `multiplier` 倍空闲价计费。设为 `enabled: false` 可始终按空闲价计费。 |
| `BALANCE_POLL_MS` | 读到余额之后，徽标的钱包重读间隔。 |
| `SYMBOL` | 各币种的符号。 |

要支持别的币种：把它的表加进 `PRICES`、把符号加进 `SYMBOL`；其余代码不假设任何币种，也不存在需要扩展的汇率表。

两个值得知道的注意点：

* 价目表是 DeepSeek 公布价格的**副本**，会过期。请对照上面链接的两个页面，并同时修改两张表。每个页面都印着高峰和空闲两列——`PRICES` 存的是**空闲**列，因为 `PEAK` 已经会把它加倍。这里搞错就是一个静默的 2 倍错误，所以值得把两列都仔细看一遍。
* **中国法定节假日没有建模**，所以落在节假日高峰窗口内的一轮会被高估。周末判断**有**建模。

## 目录结构

```
dsh-token-counter/
  package.json      # name、exports、dsh.bundle + dsh.client
  cordis.patch.yml  # bundle 的补丁层：插入本包的 Loader 行
  lib/index.js      # 宿主半：一个什么都不注册的、格式正确的 Cordis 插件
  lib/client.js     # 浏览器半：lazy-CJS 工厂 bundle
  locale/{en,zh}.json
  README.zh.md      # 本文件；README.md 是英文原文
```

这个包**签入即完整**——没有构建步骤。`lib/client.js` 是手写的成品格式浏览器 bundle（一个 `window.__ModuleLoader__.load` 工厂），`lib/index.js` 是纯 ESM，所以 DSH 加载它之前不需要编译任何东西。

宿主半是刻意留空的。DSH 通过扫描声明了 `dsh.client` 的已启用 Loader 行来发现浏览器半，所以即使功能完全在浏览器侧，这个包也需要一行宿主。

## 安装

### 从本仓库安装

```sh
dsh plugin --profile <profile> add github:OkliaoliO/dsh-token-counter
```

pnpm 解析这个 git 说明符、克隆进 profile，随后 `dsh plugin` 会重新对齐 `dsh.profile.bundles`。想要可复现的安装就钉住 tag：

```sh
dsh plugin --profile <profile> add github:OkliaoliO/dsh-token-counter#v0.3.0
```

这里**没有 `prepare` 脚本、没有构建步骤**，所以 git 安装永远不需要在安装期执行本包的代码——也就意味着 pnpm 没有任何东西需要征求你的同意。

### 手工安装

本包是一个 **bundle**：它的清单声明了 `dsh.bundle.patch`，而那个补丁会插入加载它的 Loader 行。安装意味着两件事——让这个包能以裸包名被解析，并把它写进 profile 的 bundle 列表。

1. 把包加进 `$DSH_HOME/profiles/<profile>/package.json` 的 `dependencies`；
2. 把它的名字加进该文件的 `dsh.profile.bundles`；
3. 确认这个包已经存在于 profile 的 `node_modules` 里。

```json
{
  "dependencies": { "dsh-token-counter": "file:/path/to/dsh-token-counter" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app",
                                   "dsh-token-counter"] } }
}
```

### 为什么这一行来自包本身

Loader 行的说明符必须是**裸包名**：客户端模块系统只会把包的浏览器半挂到说明符就是那个裸名的那一行上，所以从路径或子路径导出挂载的行只会加载宿主半而没有界面。这就是补丁随包发布、而 bundle 名写在 profile 里，而不是把行手工插进 profile 补丁的原因。

同一条规则也解释了为什么承载包名的四处——`package.json`、`lib/client.js` 里的 `__ModuleLoader__.load({ id })`、本包的 `cordis.patch.yml`、以及 profile 的 `dependencies`/`bundles`——必须始终一致。
