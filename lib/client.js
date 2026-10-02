/**
 * Token Counter — browser half.
 *
 * Served by the Web Client module system as the lazy-CJS factory bundle for
 * `dsh-token-counter`. It contributes two seats:
 *
 *   - `conversation.input.left`     → a resident account-balance chip.
 *   - `conversation.chat.turnTail`  → after every completed Turn, that Turn's
 *                                     token usage and what it cost.
 *
 * Per-Turn token usage is read from the `turn-tail` Chat node data the built-in
 * Conversation already derives (`TurnTailChatData.tokenUsage`), so this half never
 * re-derives usage. The wallet is read through the account Remote the Web Client
 * already mounts (`remote.account`), falling back to the raw connection RPC when
 * that namespace is absent.
 *
 * Nothing is ever converted. DeepSeek publishes one price page per currency and
 * `PRICES` carries both tables, so the interface language picks the rates; the
 * wallet is shown in the currency it is held in. Costs and the balance therefore
 * only agree when the account holds a wallet in the language's currency — which is
 * the honest outcome, not something a made-up rate should paper over.
 *
 * Labels are Simplified Chinese and live in `LABELS` below.
 */
window.__ModuleLoader__.load({
  id: 'dsh-token-counter',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    // =====================================================================
    // Configuration
    //
    // A browser half is a frozen artifact: a Loader row's `config` reaches the
    // Host half only, so tunables live here. See README.md before editing.
    // =====================================================================

    /** UI copy. */
    const LABELS = {
      balance: '余额',
      balanceTitle: '账户余额',
      balanceGated: '未登录，或当前环境无法读取账户余额',
      walletRecharged: '充值',
      walletBonus: '赠送',
      turnTokens: '本轮 Token',
      input: '输入',
      output: '输出',
      cacheHit: '缓存命中',
      cost: '本次花费',
      splitHit: '命中',
      splitMiss: '未命中',
      peak: '标准时段',
      offPeak: '优惠时段',
    }

    /**
     * Official per-1M-token rates, keyed by the currency DeepSeek publishes them
     * in: the zh-cn price page lists CNY, the en page lists USD. The interface
     * language picks the table, which is why nothing here converts anything.
     *
     * These are the OFF-PEAK rates; `PEAK` doubles them. `routes` is keyed by
     * `provider/model` and `default` covers routes with no entry. Published prices
     * change — re-check both pages and edit these tables.
     */
    const PRICES = {
      CNY: {
        routes: {
          'deepseek-account/deepseek-flash': { cacheHit: 0.02, input: 1, output: 4 },
          'deepseek-account/deepseek-v4-pro': { cacheHit: 0.15, input: 4.5, output: 13.5 },
          'deepseek/deepseek-flash': { cacheHit: 0.02, input: 1, output: 4 },
          'deepseek/deepseek-v4-pro': { cacheHit: 0.15, input: 4.5, output: 13.5 },
        },
        default: { cacheHit: 0.02, input: 1, output: 4 },
      },
      USD: {
        routes: {
          'deepseek-account/deepseek-flash': { cacheHit: 0.003, input: 0.15, output: 0.6 },
          'deepseek-account/deepseek-v4-pro': { cacheHit: 0.022, input: 0.66, output: 1.98 },
          'deepseek/deepseek-flash': { cacheHit: 0.003, input: 0.15, output: 0.6 },
          'deepseek/deepseek-v4-pro': { cacheHit: 0.022, input: 0.66, output: 1.98 },
        },
        default: { cacheHit: 0.003, input: 0.15, output: 0.6 },
      },
    }

    /** Currency used when the interface language is not Chinese, or is unknown. */
    const FALLBACK_CURRENCY = 'USD'

    /**
     * Peak windows bill at double the off-peak rate: Beijing time 09:00-12:00 and
     * 14:00-18:00, Monday-Friday — the same windows the docs state as 01:00-04:00
     * and 06:00-10:00 UTC. Chinese public holidays are NOT modelled, so a Turn
     * inside a peak window on a holiday is over-priced. Set `enabled: false` to
     * always bill at the off-peak rate.
     */
    const PEAK = { enabled: true, multiplier: 2 }

    /** How often the resident chip re-reads the wallet. */
    const BALANCE_POLL_MS = 60_000

    const SYMBOL = { CNY: '¥', USD: '$' }

    /** This build's version, reported to the account Remote. */
    function clientVersion() {
      try {
        if (typeof process !== 'undefined' && process.env && process.env.DSH_CLIENT_VERSION) {
          return String(process.env.DSH_CLIENT_VERSION)
        }
      } catch { /* no process shim in this shell */ }
      return '0.2.0-rc.2'
    }

    // =====================================================================
    // Cost accounting
    // =====================================================================

    /** Whether a wall-clock instant falls in a DeepSeek peak window. */
    function isPeak(at) {
      if (!PEAK.enabled) return false
      const d = new Date(at)
      const day = d.getUTCDay()
      if (day === 0 || day === 6) return false
      const hour = d.getUTCHours()
      return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
    }

    /** Per-1M-token rates for one route at one instant, in one currency. */
    function rateFor(route, at, currency) {
      const table = PRICES[currency] ?? PRICES[FALLBACK_CURRENCY]
      const key = route === undefined || route === null ? '' : `${route.provider}/${route.model}`
      const base = table.routes[key] ?? table.default
      const factor = isPeak(at) ? PEAK.multiplier : 1
      return {
        cacheHit: base.cacheHit * factor,
        input: base.input * factor,
        output: base.output * factor,
      }
    }

    /**
     * Price one Turn's usage, split by billing bucket, in the currency the
     * interface language prices in.
     *
     * `hitCost` prices cache-read input at the cache-hit rate; `missCost` prices
     * uncached input plus cache writes at the cache-miss rate; `outputCost` prices
     * generated tokens at the output rate. The three sum to `amount`.
     *
     * A Turn may span several routes (retries, model switches); the tokens are
     * split evenly across the distinct routes, which is exact for the normal
     * single-route Turn.
     * @returns `{ amount, hitCost, missCost, outputCost, currency, peak }`, or null without usage.
     */
    function costOf(usage, at, currency) {
      if (usage === undefined || usage === null) return null
      const routes = Array.isArray(usage.routes) && usage.routes.length > 0 ? usage.routes : [undefined]
      const share = 1 / routes.length
      let hitCost = 0
      let missCost = 0
      let outputCost = 0
      for (const route of routes) {
        const rate = rateFor(route, at, currency)
        const cacheRead = (usage.cacheReadTokens ?? 0) * share
        const uncached = (usage.uncachedInputTokens ?? 0) * share
        const cacheWrite = (usage.cacheWriteTokens ?? 0) * share
        const output = (usage.outputTokens ?? 0) * share
        hitCost += (cacheRead * rate.cacheHit) / 1e6
        missCost += ((uncached + cacheWrite) * rate.input) / 1e6
        outputCost += (output * rate.output) / 1e6
      }
      return {
        amount: hitCost + missCost + outputCost,
        hitCost,
        missCost,
        outputCost,
        currency: PRICES[currency] === undefined ? FALLBACK_CURRENCY : currency,
        peak: isPeak(at),
      }
    }

    /** Money with enough precision to stay meaningful when the amount is tiny. */
    function money(amount, currency) {
      if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—'
      const symbol = SYMBOL[currency] ?? (currency === undefined || currency === null ? '' : `${currency} `)
      const abs = Math.abs(amount)
      const digits = abs === 0 ? 2 : abs < 0.01 ? 6 : abs < 1 ? 4 : 2
      return `${symbol}${amount.toFixed(digits)}`
    }

    /** Compact token counts: 1234567 -> 1.23M. */
    function tokens(value) {
      if (value === undefined || value === null || !Number.isFinite(value)) return '0'
      if (value < 1000) return String(Math.round(value))
      if (value < 1e6) return `${(value / 1000).toFixed(value < 1e4 ? 2 : 1)}K`
      return `${(value / 1e6).toFixed(2)}M`
    }

    // =====================================================================
    // Wallet balance
    // =====================================================================

    /** Metadata the account Remote requires from this client. */
    function clientMetadata(locale) {
      return {
        version: clientVersion(),
        locale: typeof locale === 'string' && locale !== '' ? locale : 'zh',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      }
    }

    /**
     * Flatten every accepted `getBalance` payload into the wallets the account
     * holds: `null`, `{status:'ready', value, bonusWallets}`, `{status:'failed'}`,
     * and the `RemoteResult` envelope around them.
     *
     * BOTH lists matter, and this is the bug an earlier revision shipped: it read
     * only `value` and only its first entry, so an account whose topped-up wallet
     * had run down while a granted wallet still held money reported the wrong
     * number. DeepSeek deducts from the topped-up wallet and the granted wallet
     * alike, preferring the granted one, so the usable balance of a currency is
     * the two added together.
     */
    function walletAmounts(result) {
      let payload = result
      if (payload !== null && typeof payload === 'object' && !Array.isArray(payload) && 'ok' in payload) {
        if (payload.ok !== true) return []
        payload = payload.value
      }
      if (payload === null || payload === undefined) return []
      if (!Array.isArray(payload) && payload.status === 'failed') return []
      const recharged = Array.isArray(payload)
        ? payload
        : payload.status === 'ready' ? payload.value : []
      const bonus = Array.isArray(payload) ? [] : payload.bonusWallets
      const tagged = (list, isBonus) => (Array.isArray(list) ? list : [])
        .filter((wallet) => wallet !== null && wallet !== undefined && Number.isFinite(Number(wallet.balance)))
        .map((wallet) => ({
          currency: wallet.currency ?? FALLBACK_CURRENCY,
          balance: Number(wallet.balance),
          bonus: isBonus,
        }))
      return tagged(recharged, false).concat(tagged(bonus, true))
    }

    /**
     * The wallet to display: every entry in the interface language's currency,
     * added together; failing that, every entry of the account's first currency.
     *
     * Nothing is converted — an account holding no wallet in the language's
     * currency simply shows the currency it does hold.
     * @returns `{ currency, balance, recharged, bonus }`, or undefined.
     */
    function walletFor(wallets, preferred) {
      if (wallets.length === 0) return undefined
      const matching = wallets.filter((wallet) => wallet.currency === preferred)
      const chosen = matching.length > 0
        ? matching
        : wallets.filter((wallet) => wallet.currency === wallets[0].currency)
      const sum = (isBonus) => chosen
        .filter((wallet) => wallet.bonus === isBonus)
        .reduce((total, wallet) => total + wallet.balance, 0)
      const recharged = sum(false)
      const bonus = sum(true)
      return { currency: chosen[0].currency, balance: recharged + bonus, recharged, bonus }
    }

    /**
     * Ask for the wallets through the account Remote, then through the raw
     * connection RPC, and resolve to the flattened list (empty on any failure).
     *
     * Each Remote namespace is its own Cordis service (`remote.account`), and
     * `ctx.get` reads the registry without the `inject` gate — so the balance is
     * reachable without importing anything. The namespace only exists once the
     * api-remotes client half has mounted it, hence the guard and the fallback.
     */
    function readWallets(ctx, locale) {
      const client = clientMetadata(locale)

      const account = ctx.get('remote.account', false)
      if (account !== undefined && account !== null && typeof account.getBalance === 'function') {
        return Promise.resolve(account.getBalance(client)).then(walletAmounts, () => [])
      }

      const connection = ctx.get('connection', false)
      const rpc = connection === undefined || connection === null ? undefined : connection.rpc
      if (rpc !== undefined && rpc !== null && typeof rpc.call === 'function') {
        return Promise.resolve(rpc.call('/api', 'account/getBalance', { args: { client } }))
          .then(walletAmounts, () => [])
      }

      return Promise.resolve([])
    }

    /** The active interface language, or undefined when no locale service is up. */
    function currentLocale(ctx) {
      try {
        const localeService = ctx.get('locale', false)
        return localeService === undefined || localeService === null
          ? undefined
          : localeService.getSnapshot().active
      } catch {
        return undefined
      }
    }

    /** Currency the interface language works in: a Chinese UI uses CNY. */
    function localeCurrency(locale) {
      return typeof locale === 'string' && locale.toLowerCase().startsWith('zh')
        ? 'CNY'
        : FALLBACK_CURRENCY
    }

    /**
     * Snapshot holder shared by every seat of this plugin.
     *
     * It keeps the raw wallet list and the language-selected currency, and derives
     * the displayed wallet from both — so switching language re-selects a wallet
     * the account already holds without another network round trip.
     *
     * The account namespace mounts asynchronously, so a miss polls fast until the
     * first reading lands and slowly afterwards. The timer and the language
     * subscription live in the plugin's effect scope, so unloading stops both.
     */
    function createStore(ctx) {
      let state = {
        state: 'loading',
        wallets: [],
        priceCurrency: localeCurrency(currentLocale(ctx)),
      }
      let timer = null
      const listeners = new Set()
      const publish = (next) => {
        state = next
        for (const listener of listeners) listener()
      }
      const schedule = () => {
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(refresh, state.state === 'ready' ? BALANCE_POLL_MS : 3_000)
      }
      const refresh = () => {
        readWallets(ctx, currentLocale(ctx)).then(
          (wallets) => publish({ ...state, state: wallets.length === 0 ? 'unavailable' : 'ready', wallets }),
          () => publish({ ...state, state: 'unavailable', wallets: [] }),
        ).then(schedule)
      }
      ctx.effect(() => {
        refresh()
        // A language switch changes which wallet is selected, so it has to
        // re-publish even though no wallet itself changed.
        const localeService = ctx.get('locale', false)
        const unsubscribe = localeService !== undefined && localeService !== null
          && typeof localeService.subscribe === 'function'
          ? localeService.subscribe(() => {
              publish({ ...state, priceCurrency: localeCurrency(currentLocale(ctx)) })
            })
          : undefined
        return () => {
          if (unsubscribe !== undefined) unsubscribe()
          if (timer !== null) clearTimeout(timer)
          timer = null
          listeners.clear()
        }
      }, 'token-counter: wallet and language')
      return {
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        getSnapshot: () => ({ ...state, wallet: walletFor(state.wallets, state.priceCurrency) }),
        refresh,
      }
    }

    /** Bind a snapshot holder to React state. */
    function useWallet(store) {
      const [value, setValue] = React.useState(store.getSnapshot)
      React.useEffect(
        () => store.subscribe(() => { setValue(store.getSnapshot()) }),
        [store],
      )
      return value
    }

    /** The selected wallet, as the platform reports it — no conversion at all. */
    function balanceText(snapshot) {
      if (snapshot.state !== 'ready' || snapshot.wallet === undefined) {
        return snapshot.state === 'loading' ? '…' : '—'
      }
      return money(snapshot.wallet.balance, snapshot.wallet.currency)
    }

    /** The topped-up / granted split, for the chip's tooltip. */
    function balanceDetail(snapshot) {
      const wallet = snapshot.wallet
      if (snapshot.state !== 'ready' || wallet === undefined) return null
      return `${LABELS.walletRecharged} ${money(wallet.recharged, wallet.currency)}`
        + ` · ${LABELS.walletBonus} ${money(wallet.bonus, wallet.currency)}`
    }

    // =====================================================================
    // Presentation
    // =====================================================================

    /**
     * Three roles, three colours.
     *
     * `.dsh-tc-label` is the neutral run (Chinese labels, separators, brackets).
     * `.dsh-tc-count` is a token count — kept neutral as well, so the four usage
     * entries DSH already reports stay visually apart from the money and the
     * green marks spend alone. `.dsh-tc-value` is therefore reserved for figures
     * of money, and `.dsh-tc-period` names the billing window the Turn landed in.
     * The neutral pair flips with the shell's pre-paint dark marker, and both
     * containers pin the base weight.
     */
    const CSS = `
.dsh-tc-chip{display:inline-flex;align-items:center;gap:.375rem;font-size:.75rem;line-height:1.5;
  font-weight:400;color:#000;white-space:nowrap;font-variant-numeric:tabular-nums;cursor:default}
/* One section per line, always: usage, then cost, then the input/output detail. */
.dsh-tc-tail{display:flex;flex-direction:column;align-items:flex-start;gap:.125rem;font-size:.75rem;
  line-height:1.5;font-weight:400;color:#000;font-variant-numeric:tabular-nums}
body[data-ds-dark-theme] .dsh-tc-chip,
body[data-ds-dark-theme] .dsh-tc-tail{color:#fff}
.dsh-tc-part{white-space:nowrap}
.dsh-tc-label{color:inherit;font-weight:400}
.dsh-tc-count{color:inherit;font-weight:500}
.dsh-tc-value{color:var(--dsw-alias-success,#22c55e);font-weight:500}
.dsh-tc-period{color:var(--dsw-alias-link,#4d6bfe);font-weight:400}
.dsh-tc-dot{width:.375rem;height:.375rem;border-radius:50%;background:currentColor;opacity:.5;
  flex:none;align-self:center}
`

    /** A neutral run: a label, separator, note, or bracket. */
    function label(text) {
      return React.createElement('span', { className: 'dsh-tc-label' }, text)
    }

    /** A token count: neutral, so green is left to mark money. */
    function count(text) {
      return React.createElement('span', { className: 'dsh-tc-count' }, text)
    }

    /** A figure of money. */
    function value(text) {
      return React.createElement('span', { className: 'dsh-tc-value' }, text)
    }

    /** The billing window this Turn landed in. */
    function period(text) {
      return React.createElement('span', { className: 'dsh-tc-period' }, text)
    }

    /** Resident wallet chip. */
    function BalanceChip(props) {
      const snapshot = useWallet(props.store)
      const detail = balanceDetail(snapshot)
      const title = detail === null ? LABELS.balanceGated : `${LABELS.balanceTitle}：${detail}`
      return React.createElement(
        'span',
        { className: 'dsh-tc-chip', title },
        React.createElement('span', { className: 'dsh-tc-dot' }),
        label(LABELS.balance),
        value(balanceText(snapshot)),
      )
    }

    /**
     * The completed-Turn readout.
     *
     * The owner supplies the Turn's location; the built-in Conversation has
     * already folded the Turn's token usage into its `turn-tail` location data.
     */
    function TurnCost(props) {
      const store = props.store
      const snapshot = useWallet(store)
      const seq = props.seq
      React.useEffect(() => { store.refresh() }, [store, seq])

      const turn = props.turn
      const data = turn === undefined || turn === null || turn.data === undefined
        ? undefined
        : turn.data.get('turn-tail')
      const usage = data === undefined || data === null ? undefined : data.tokenUsage
      if (usage === undefined || usage === null || usage.totalTokens === undefined) return null

      const at = data !== undefined && typeof data.time === 'number' ? data.time : Date.now()
      const cost = costOf(usage, at, snapshot.priceCurrency)
      if (cost === null) return null

      // `.dsh-tc-part` is plain inline flow, so the space between a label and its
      // figure is an explicit text node rather than a flex gap.
      const children = []

      children.push(React.createElement('span', { className: 'dsh-tc-part', key: 'tokens' },
        label(LABELS.turnTokens), ' ', count(tokens(usage.totalTokens)),
        label(' · '),
        label(LABELS.input), ' ', count(tokens((usage.uncachedInputTokens ?? 0) + (usage.cacheReadTokens ?? 0))),
        label(' · '),
        label(LABELS.output), ' ', count(tokens(usage.outputTokens)),
        usage.cacheReadTokens === undefined ? null : label(' · '),
        usage.cacheReadTokens === undefined ? null : label(LABELS.cacheHit),
        usage.cacheReadTokens === undefined ? null : ' ',
        usage.cacheReadTokens === undefined ? null : count(tokens(usage.cacheReadTokens)),
      ))

      children.push(React.createElement('span', { className: 'dsh-tc-part', key: 'cost' },
        label(LABELS.cost), ' ', value(money(cost.amount, cost.currency)),
        ' ', period(cost.peak ? LABELS.peak : LABELS.offPeak),
      ))

      // Input cost with the cache-hit/miss split that produced it, then output.
      // The two top-level figures sum to the total above.
      children.push(React.createElement('span', { className: 'dsh-tc-part', key: 'split' },
        label(LABELS.input), ' ', value(money(cost.hitCost + cost.missCost, cost.currency)),
        label('（'), label(LABELS.splitHit), ' ', value(money(cost.hitCost, cost.currency)),
        label(' · '), label(LABELS.splitMiss), ' ', value(money(cost.missCost, cost.currency)),
        label('）'),
        label(' · '),
        label(LABELS.output), ' ', value(money(cost.outputCost, cost.currency)),
      ))

      // The wallet is deliberately not repeated here: the composer chip owns it,
      // and this readout stays a per-Turn accounting of tokens and money spent.
      // The Turn still kicks a wallet refresh so that chip is current.
      return React.createElement('span', { className: 'dsh-tc-tail' }, children)
    }

    // =====================================================================
    // Plugin
    // =====================================================================

    /**
     * Only `slots` is a hard dependency: the wallet is read opportunistically so
     * the token and cost readout still renders when no account namespace exists.
     */
    const inject = ['slots']

    function apply(ctx) {
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)
      ctx.effect(() => () => { style.remove() })

      const store = createStore(ctx)

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
        { name: 'conversation.input.left', id: 'token-counter-balance', order: 40 },
        () => React.createElement(BalanceChip, { store }),
      ))

      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register(
        { name: 'conversation.chat.turnTail', id: 'token-counter-turn', order: 40 },
        (props) => React.createElement(TurnCost, {
          store,
          turn: props.turn,
          seq: props.seq,
        }),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
