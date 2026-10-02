# dsh-token-counter

English | [中文](README.zh.md)

A DeepSeek Harness (DSH) plugin that shows **the account balance** and, after every conversation turn, that turn's **token usage** and **what it cost**.

> Written by **DeepSeek-V4.1-Flash** at **maximum reasoning effort (max)**.

## What it looks like

The composer tool row, always resident:

```
● Balance $10.00
```

After every completed Turn — the Turn footer, always three lines:

```
Turn tokens 1.23M · in 1.20M · out 30.0K · cache hit 1.10M
Cost $0.0363 off-peak
in $0.0183 (hit $0.0033 · miss $0.0150) · out $0.0180
```

Colour carries the roles: **money figures** are green and medium-weight, **labels and brackets** are neutral, the **peak/off-peak marker** is blue. When there is nothing to show, neither entry renders at all — no empty frame.

That example adds up. At off-peak `deepseek-flash` USD rates — cache hit $0.003, cache miss $0.15, output $0.6 per 1M — 1.10M cached input costs $0.0033, 0.10M uncached input costs $0.0150 (together $0.0183), and 30.0K output costs $0.0180, for a Turn total of $0.0363.

A Chinese interface renders the same Turn as `本轮 Token …` / `本次花费 ¥0.2420 优惠时段` / `输入 ¥0.1220（命中 ¥0.0220 · 未命中 ¥0.1000） · 输出 ¥0.1200` — priced from DeepSeek's CNY page, not converted from the USD one.

## Install

```sh
dsh plugin --profile <profile> add github:OkliaoliO/dsh-token-counter
```

Pin a tag for a reproducible install:

```sh
dsh plugin --profile <profile> add github:OkliaoliO/dsh-token-counter#v0.3.0
```

There is **no `prepare` script and no build step** — `lib/client.js` is the finished bundle, written by hand — so a git install never runs package code at install time, and pnpm has nothing to ask you to approve.

### Manual install

This package is a **bundle**: its manifest declares `dsh.bundle.patch`, and that patch inserts the Loader row that loads it. Installing by hand means three things:

1. add the package to `dependencies` in `$DSH_HOME/profiles/<profile>/package.json`;
2. add its name to that file's `dsh.profile.bundles`;
3. make sure the package is present in the profile's `node_modules`.

```json
{
  "dependencies": { "dsh-token-counter": "file:/path/to/dsh-token-counter" },
  "dsh": { "profile": { "bundles": [
    "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-token-counter"
  ] } }
}
```

## What the interface language decides

Three things, in both entries:

| Interface language | Price list | Display currency | Copy |
| --- | --- | --- | --- |
| `zh*` | `PRICES.CNY` | `CNY` | `DICTS.zh` |
| anything else | `PRICES.USD` | `USD` | `DICTS.en` |

Switching language in DSH re-renders everything immediately: it re-labels the copy, re-picks the price table, and re-selects among the wallets the account already holds. Turns already on screen change with it, and no extra network request is involved.

## Configuration

A browser half is a frozen artifact — a Loader row's `config` reaches the Host half only — so tunables are named constants at the top of `lib/client.js`:

| Constant | Meaning |
| --- | --- |
| `DICTS` | UI copy, one dictionary per interface language, selected by `labelsFor` |
| `PRICES` | Official per-1M-token rates, **keyed by currency** (`CNY` / `USD`), each with `routes` (keyed by `provider/model`) plus a `default`. Values are that currency's **off-peak** column |
| `FALLBACK_CURRENCY` | Currency used when the interface language is not Chinese, or is unknown |
| `PEAK` | Peak-window multiplier; set `enabled: false` to always bill off-peak |
| `BALANCE_POLL_MS` | Wallet re-read interval for the chip, once a reading has landed |
| `SYMBOL` | Currency symbol per code |

Price sources: <https://api-docs.deepseek.com/zh-cn/quick_start/pricing/> (CNY) and <https://api-docs.deepseek.com/quick_start/pricing/> (USD). **Both tables must be edited together.** Each page prints a peak and an off-peak column; `PRICES` holds the off-peak one, because `PEAK` already doubles it.

## How it works

**Token usage is not re-derived.** The built-in Conversation already folds each Turn's usage into its `turn-tail` location data, and the plugin reads `props.turn.data.get('turn-tail').tokenUsage` directly.

**Cost** is split into the three buckets DeepSeek actually bills on: cache-hit input, cache-miss input (uncached input plus cache writes), and output. The three sum to the total above them; the readout groups the two input buckets under one `in` figure with the split in parentheses.

**Balance** is read through the account Remote the Web Client already mounts: `remote.account.getBalance({ version, locale, timezoneOffsetSeconds })`. **No exchange rate is involved anywhere** — costs use the official price table for the language's currency, and the balance is shown in the currency the account holds.

The balance is the sum of **both** wallet lists `getBalance` returns: `value` (the topped-up wallet) and `bonusWallets` (the granted wallet). DeepSeek deducts from both, preferring the granted one, so reading only `value` misses the granted balance. Hovering the chip shows the split (`充值 ¥0.00 · 赠送 ¥3.24`).

## Notes

- **The price tables are copies and can go stale.** See the two links above.
- **Chinese public holidays are not modelled**, so a Turn inside a peak window on a holiday is over-priced. Weekends *are* modelled.
- **When the account's currency differs from the language's**, costs and the balance simply read in two different currencies and cannot be subtracted. The plugin does not invent a rate to paper over that; it shows the currency the account actually holds.
- Only `slots` is a hard dependency. With no account or locale service available the readout still renders — the balance shows `—` and the copy falls back to English.

## Layout and packaging

```
dsh-token-counter/
  package.json      # name, exports, dsh.bundle + dsh.client
  cordis.patch.yml  # the bundle's patch layer: inserts this package's Loader row
  lib/index.js      # Host half (deliberately empty)
  lib/client.js     # Browser half: the lazy-CJS factory bundle
  locale/{en,zh}.json
  README.md         # this file; README.zh.md is the Chinese version
```

**Complete as checked in — there is no build step.** `lib/client.js` is the finished bundle format written by hand (a single `window.__ModuleLoader__.load` factory), and `lib/index.js` is plain ESM, so nothing has to be compiled before DSH can load it.

The Host half is intentionally empty: DSH discovers a browser half by scanning enabled Loader rows for packages that declare `dsh.client`, so the package needs a Host row even though the feature is entirely browser-side.

### If you fork this: one hard rule

The Loader row's specifier must be the **bare package name** — the client module system attaches a package's browser half only to the row whose specifier is that bare name. So the **four places** carrying the package name must always agree:

1. `package.json`'s `name`
2. `lib/client.js`'s `__ModuleLoader__.load({ id })`
3. this package's `cordis.patch.yml` (`- name:`)
4. the profile's `dependencies` key and `dsh.profile.bundles`

A mismatch in the second one is the hardest to diagnose: the Host half and the plugin list both look perfectly healthy, **but nothing appears in the interface at all**.

## License

GPL-3.0-only, © OkliaoliO.
