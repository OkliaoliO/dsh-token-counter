/**
 * Token Counter — Host half.
 *
 * The whole feature is browser-side: per-turn token usage already travels to the
 * Web Client in the `turn-tail` Chat node data, and the wallet balance is read
 * through the account Remote the client already owns. This half exists so the
 * package is a well-formed Cordis plugin (and so the Loader has a Host row to
 * activate); it deliberately registers nothing.
 */

/** Cordis plugin name. */
export const name = 'token-counter'

/**
 * Activate the Host half.
 *
 * Intentionally empty: see the module docblock.
 */
export function apply() {}
