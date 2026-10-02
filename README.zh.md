# dsh-token-counter

[English](README.md) | 中文

一个 DeepSeek Harness（DSH）插件：显示**账户余额**，并在每轮对话结束后显示该轮的 **Token 消耗量**与**本次花费**。

> 本插件由 **DeepSeek-V4.1-Flash** 在**最高推理强度（max）**下编写。

## 它长什么样

输入框工具栏，常驻：

```
● 余额 ¥3.24
```

每轮对话结束后——回合页脚，固定三行：

```
本轮 Token 1.23M · 输入 1.20M · 输出 30.0K · 缓存命中 1.10M
本次花费 ¥0.2420 优惠时段
输入 ¥0.1220（命中 ¥0.0220 · 未命中 ¥0.1000） · 输出 ¥0.1200
```

颜色承担分工：**金额数字**绿色、中等字重，**标签与括号**中性色，**高峰/空闲标记**蓝色。没有内容可显示时两个条目都不渲染——不会留一个空框。

上例可以验算。空闲时段 `deepseek-flash` 的人民币价是命中 ¥0.02、未命中 ¥1、输出 ¥4（每百万）：1.10M 命中输入花 ¥0.0220，0.10M 未命中输入花 ¥0.1000（合计 ¥0.1220），30.0K 输出花 ¥0.1200，本轮总计 ¥0.2420。

英文界面下同一轮显示为 `Turn tokens …` / `Cost $0.0363 off-peak` / `in $0.0183 (hit $0.0033 · miss $0.0150) · out $0.0180`——按 DeepSeek 的美元价目页计价，而不是从人民币价换算过来的。

## 安装

```sh
dsh plugin --profile <profile> add github:OkliaoliO/dsh-token-counter
```

钉住版本以获得可复现的安装：

```sh
dsh plugin --profile <profile> add github:OkliaoliO/dsh-token-counter#v0.3.0
```

本包**没有 `prepare` 脚本、也没有构建步骤**——`lib/client.js` 就是手写的成品 bundle——所以 git 安装不会在安装期执行任何包代码，pnpm 也没有任何东西需要征求你的同意。

### 手工安装

本包是一个 **bundle**：它的清单声明了 `dsh.bundle.patch`，由那个补丁插入加载它的 Loader 行。手工安装要做三件事：

1. 把包加进 `$DSH_HOME/profiles/<profile>/package.json` 的 `dependencies`；
2. 把包名加进同一文件的 `dsh.profile.bundles`；
3. 确认包已经在 profile 的 `node_modules` 里。

```json
{
  "dependencies": { "dsh-token-counter": "file:/path/to/dsh-token-counter" },
  "dsh": { "profile": { "bundles": [
    "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-token-counter"
  ] } }
}
```

## 界面语言决定什么

三件事，两个条目都适用：

| 界面语言 | 价目表 | 显示币种 | 文案 |
| --- | --- | --- | --- |
| `zh*` | `PRICES.CNY` | `CNY` | `DICTS.zh` |
| 其它 | `PRICES.USD` | `USD` | `DICTS.en` |

在 DSH 里切换语言会立刻重渲染全部内容：重新标注文案、重新选择价目表、并在账户已持有的钱包里重新选择。已经显示在屏幕上的历史轮次也会一起变，且不涉及额外的网络请求。

## 配置

浏览器半是冻结产物——Loader 行的 `config` 只送达宿主半——所以可调项是 `lib/client.js` 顶部的具名常量：

| 常量 | 含义 |
| --- | --- |
| `DICTS` | 界面文案，每种界面语言一份字典，由 `labelsFor` 选择 |
| `PRICES` | 官方每百万 token 价，**按币种分表**（`CNY` / `USD`），每张表含 `routes`（按 `provider/model` 索引）与一个 `default`。数值取该币种的**空闲时段**列 |
| `FALLBACK_CURRENCY` | 界面语言不是中文（或未知）时使用的币种 |
| `PEAK` | 高峰时段加倍系数；设 `enabled: false` 可始终按空闲价计费 |
| `BALANCE_POLL_MS` | 读到余额之后，徽标的钱包重读间隔 |
| `SYMBOL` | 各币种的符号 |

价目表出处：<https://api-docs.deepseek.com/zh-cn/quick_start/pricing/>（CNY）与 <https://api-docs.deepseek.com/quick_start/pricing/>（USD）。**两张表必须一起改。** 每个页面都印着高峰与空闲两列，`PRICES` 存的是空闲列，因为 `PEAK` 已经会把它加倍。

## 工作原理

**Token 用量不重复计算。** 内置的 Conversation 已经把每一轮的用量折算进 `turn-tail` 位置数据，插件直接读 `props.turn.data.get('turn-tail').tokenUsage`。

**花费**按 DeepSeek 实际计费的三个桶拆分：缓存命中的输入、未命中的输入（未命中输入加缓存写入）、以及输出。三个数字相加等于它们上方的总额；读数把两个输入桶合并成一个 `输入` 数字，拆分放在括号里。

**余额**通过 Web Client 已经挂载的账户 Remote 读取：`remote.account.getBalance({ version, locale, timezoneOffsetSeconds })`。**全程不涉及任何汇率**——费用用语言对应币种的官方价目表，余额直接显示账户持有的币种。

余额取的是 `getBalance` 返回的**两个**钱包列表之和：`value`（充值余额）与 `bonusWallets`（赠送余额）。DeepSeek 两个都扣、优先扣赠送，所以只读 `value` 会漏掉赠送余额。悬停徽标可以看到拆分（`充值 ¥0.00 · 赠送 ¥3.24`）。

## 注意事项

- **价目表是副本，会过期。** 见上面两个链接。
- **中国法定节假日没有建模**，所以落在节假日高峰窗口内的一轮会被高估。周末**有**建模。
- **账户币种与语言币种不一致时**，费用与余额就是两种不同币种，无法相减。插件不会为此编造一个汇率，它只显示账户实际持有的币种。
- 硬依赖只有 `slots`。账户或 locale 服务不可用时读数照常渲染——余额显示 `—`，文案回落到英文。

## 目录结构与打包形态

```
dsh-token-counter/
  package.json      # name、exports、dsh.bundle + dsh.client
  cordis.patch.yml  # bundle 的补丁层：插入本包的 Loader 行
  lib/index.js      # 宿主半（刻意留空）
  lib/client.js     # 浏览器半：lazy-CJS 工厂 bundle
  locale/{en,zh}.json
  README.zh.md      # 本文件；README.md 是英文版
```

**签入即完整——没有构建步骤。** `lib/client.js` 是手写的成品 bundle 格式（一个 `window.__ModuleLoader__.load` 工厂），`lib/index.js` 是纯 ESM，所以 DSH 加载它之前不需要编译任何东西。

宿主半是刻意留空的：DSH 通过扫描声明了 `dsh.client` 的已启用 Loader 行来发现浏览器半，所以即使功能完全在浏览器侧，这个包也需要一行宿主。

### 要 fork 的话：一条硬规则

Loader 行的说明符必须是**裸包名**——客户端模块系统只会把包的浏览器半挂到说明符就是那个裸名的那一行上。所以承载包名的**四处必须始终一致**：

1. `package.json` 的 `name`
2. `lib/client.js` 里的 `__ModuleLoader__.load({ id })`
3. 本包 `cordis.patch.yml` 的 `- name:`
4. profile 的 `dependencies` 键与 `dsh.profile.bundles`

第 2 处不一致最难诊断：宿主半和插件列表都看起来完全正常，**但界面上什么都不出现**。

## 许可

GPL-3.0-only，版权归 OkliaoliO。
