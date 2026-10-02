# Token Counter

一个 DeepSeek Harness（DSH）插件：显示账户余额，并在每轮对话结束后显示该轮的 Token 消耗量与本次花费。本插件由 **DeepSeek-V4.1-Flash** 在**最高推理强度（max）**下编写。

A DeepSeek Harness (DSH) plugin that shows **the account balance** and, after every
conversation turn, that turn's **token usage** and **what it cost**. Written by
**DeepSeek-V4.1-Flash** at **maximum reasoning effort (max)**.

## What it renders

| Seat | Content |
| --- | --- |
| `conversation.input.left` (resident composer tool row) | The wallet chip — the only place the balance appears: `余额 ¥3.24`. Shows the account's wallets in the interface language's currency, added together, exactly as the platform reports them. Refreshed every minute and after every turn. |
| `conversation.chat.turnTail` (completed-Turn footer) | The per-Turn accounting, no balance, always on three lines — usage, then cost, then the input/output detail. |

Every currency figure in both seats follows the interface language: the price list for
costs, and the wallet selection for the balance. Switching language in DSH re-renders
both without another network round trip, including Turns already on screen.

With a Chinese interface, a `deepseek-flash` Turn at off-peak rates reads:

```
本轮 Token 1.23M · 输入 1.20M · 输出 30.0K · 缓存命中 1.10M
本次花费 ¥0.2420 优惠时段
输入 ¥0.1220（命中 ¥0.0220 · 未命中 ¥0.1000） · 输出 ¥0.1200
```

It is a column, so each of those three sections takes its own line no matter how wide
the panel is; a section is `white-space: nowrap`, so it never splits across lines
itself. Both entries render `null` when they have nothing to show, which is how a list
entry declines a seat.

### The example adds up

At off-peak `deepseek-flash` CNY rates (命中 ¥0.02, 未命中 ¥1, 输出 ¥4 per 1M): 1.10M
cached input costs ¥0.0220, 0.10M uncached input costs ¥0.1000 — together ¥0.1220 —
and 30.0K output costs ¥0.1200, for a Turn total of ¥0.2420. 输入 1.20M is the sum of
the cached and uncached halves.

## How it works

* **Token usage** is not re-derived. The built-in Conversation already folds each
  Turn's usage into its `turn-tail` location data; this plugin reads
  `props.turn.data.get('turn-tail').tokenUsage`, which carries `uncachedInputTokens`,
  `outputTokens`, `totalTokens`, `cacheReadTokens?`, `cacheWriteTokens?`,
  `reasoningTokens?` and `routes?`.
* **Cost** is computed from that usage and the price table in `lib/client.js`, split
  into the three buckets DeepSeek bills on: **命中** (cache-read input, at the
  cache-hit rate), **未命中** (uncached input plus cache writes, at the cache-miss
  rate), and **输出** (generated tokens). The three figures sum to the total shown
  before them; the readout groups the two input buckets under one `输入` figure with
  the hit/miss split in parentheses. A Turn that spans several routes splits its
  tokens evenly across them, which is exact for the normal single-route Turn.
* **Balance** is read through the account Remote the Web Client already mounts
  (`remote.account.getBalance({ version, locale, timezoneOffsetSeconds })`), returning
  `{ ok, value }` where `value` is `null`,
  `{ status: 'ready', value: AccountWallet[], bonusWallets }`, or
  `{ status: 'failed' }`. When that namespace is absent the plugin falls back to the
  raw `connection.rpc.call('/api', 'account/getBalance', { args: { client } })` wire.
  Only `slots` is a hard dependency, so the token and cost readout still renders when
  no account is available.

### Which currency everything uses

The **interface language** decides, for both seats:

| Interface language | Currency and price list | Source |
| --- | --- | --- |
| `zh*` | `CNY`, priced from `PRICES.CNY` | <https://api-docs.deepseek.com/zh-cn/quick_start/pricing/> |
| anything else | `PRICES.USD` | <https://api-docs.deepseek.com/quick_start/pricing/> |

The plugin subscribes to the client `locale` service, so switching language in DSH
re-prices the readout immediately — including Turns already on screen.

### Where conversion does and does not happen

Nowhere. That is the whole point of carrying both price tables.

**Costs** are priced from the table the language selects — a real published price list,
so no rate assumption sits between the number shown and the number billed.

**The wallet** needs no conversion either, once both wallet lists are read properly.
`getBalance` returns **two** lists — `value` (the topped-up wallet) and `bonusWallets`
(the granted wallet) — and DeepSeek deducts from both, preferring the granted one. So
the balance of a currency is the two added together, and the plugin selects the
currency the interface language works in. The chip's tooltip shows the split
(`充值 ¥0.00 · 赠送 ¥3.24`), which is also how the one real bug in this plugin was
found: an earlier revision read only `value` and only its first entry, so an account
whose topped-up wallet had run to zero while a granted wallet still held money showed
`¥0.00`.

If the account holds no wallet in the language's currency, the plugin shows the
currency it does hold rather than inventing a rate. Costs and the balance then read in
different currencies, and are not subtractable — the honest outcome.

## Colours

Both readouts are one size, with their roles separated by **colour** rather than by
opacity or weight:

* `.dsh-tc-label` — Chinese labels, separators, notes, and brackets. Neutral: black,
  flipping to white under `body[data-ds-dark-theme]`, weight 400.
* `.dsh-tc-count` — token counts and their `K`/`M` suffixes. Neutral too (weight 500),
  so the four usage entries DSH already reports stay visually apart from the money and
  green is left to mark spend alone.
* `.dsh-tc-value` — figures of money and their currency symbols. The theme's success
  green (`--dsw-alias-success`, fallback `#22c55e`), weight 500.
* `.dsh-tc-period` — the `优惠时段` / `标准时段` marker, in the theme's link blue
  (`--dsw-alias-link`, fallback `#4d6bfe`).

Splitting the neutral run from the money by colour is deliberate: the CJK and Latin
faces do not share a weight, so tinting them alike made that difference read as a
mistake. Both containers pin the base weight, so the readout cannot inherit one from
the seat it is mounted in.

## Configuration

A browser half is a frozen artifact — a Loader row's `config` reaches the Host half
only — so tunables live in **`lib/client.js`** as named constants at the top:

| Constant | Meaning |
| --- | --- |
| `LABELS` | UI copy (Simplified Chinese by default). |
| `PRICES` | Official per-1M-token rates **keyed by currency** (`CNY`, `USD`), each with `routes` keyed by `provider/model` plus a `default`. Values are the **off-peak** rates from that currency's page. |
| `FALLBACK_CURRENCY` | Currency used when the interface language is not Chinese (or is unknown). |
| `PEAK` | Peak windows (Beijing 09:00–12:00 and 14:00–18:00, Mon–Fri) bill at `multiplier`× the off-peak rate. Set `enabled: false` to always bill off-peak. |
| `BALANCE_POLL_MS` | Wallet re-read interval for the resident chip once a reading has landed. |
| `SYMBOL` | Currency symbol per code. |

To support another currency, add its table to `PRICES` and its symbol to `SYMBOL`;
nothing else assumes a currency, and no rate table exists to extend.

Two caveats worth knowing:

* The price tables are **copies** of DeepSeek's published rates and can go stale.
  Re-check both pages linked above and edit both tables. Each page prints a peak and an
  off-peak column — `PRICES` holds the **off-peak** column, because `PEAK` already
  doubles it. Getting this wrong is a silent 2× error, so it is worth re-reading both
  columns carefully.
* **Chinese public holidays are not modelled**, so a turn inside a peak window on a
  holiday is over-priced. Weekend detection *is* modelled.

## Layout

```
dsh-token-counter/
  package.json      # name, exports, dsh.bundle + dsh.client
  cordis.patch.yml  # the bundle's patch layer: inserts this package's Loader row
  lib/index.js      # Host half: a well-formed Cordis plugin that registers nothing
  lib/client.js     # Browser half: the lazy-CJS factory bundle
  locale/{en,zh}.json
```

The package is **complete as checked in** — there is no build step. `lib/client.js` is
the built-format browser bundle written by hand (a single `window.__ModuleLoader__.load`
factory), and `lib/index.js` is plain ESM, so nothing has to be compiled before DSH can
load it.

The Host half is intentionally empty. DSH discovers a browser half by scanning enabled
Loader rows for packages that declare `dsh.client`, so the package needs a Host row
even though the feature is entirely browser-side.

## Install

### From this repository

```sh
dsh plugin --profile <profile> add github:OkliaoliO/dsh-token-counter
```

pnpm resolves the git specifier, clones into the profile, and `dsh plugin` reconciles
`dsh.profile.bundles` afterwards. Pin a tag for a reproducible install:

```sh
dsh plugin --profile <profile> add github:OkliaoliO/dsh-token-counter#v0.3.0
```

There is **no `prepare` script and no build step**, so a git install never has to run
the package's code at install time — which also means pnpm has nothing to ask you to
approve.

### By hand

This package is a **bundle**: its manifest declares `dsh.bundle.patch`, and that patch
inserts the Loader row that loads it. Installing means two things — make the package
resolvable under its bare name, and name it in the profile's bundle list.

1. add the package to `dependencies` in `$DSH_HOME/profiles/<profile>/package.json`;
2. add its name to that file's `dsh.profile.bundles`;
3. make sure the package is present in the profile's `node_modules`.

```json
{
  "dependencies": { "dsh-token-counter": "file:/path/to/dsh-token-counter" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app",
                                   "dsh-token-counter"] } }
}
```

### Why the row comes from the package

The Loader row's specifier must be the **bare package name**: the client module system
attaches a package's browser half only to the row whose specifier is that bare name, so
a row mounted from a path or a subpath export would load the Host half with no UI. That
is why the patch ships inside the package and the bundle is named in the profile, rather
than the row being hand-inserted into the profile patch.

The same rule is why the four places that carry the package name — `package.json`,
`lib/client.js`'s `__ModuleLoader__.load({ id })`, this package's `cordis.patch.yml`,
and the profile's `dependencies`/`bundles` — must always agree.
