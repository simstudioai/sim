/**
 * Stable key derivation for block/tool/connector strings.
 *
 * Block, tool, and connector definitions are plain `.ts` objects that are
 * serialized into workflows, so their user-facing strings (name, description,
 * subblock titles, …) can't host a React hook. Instead the UI translates them at
 * render time by deriving a deterministic key from the English source string and
 * looking it up in the `blocks` message namespace (falling back to the English
 * source when a key is missing).
 *
 * The extraction script (`scripts/i18n-extract-blocks.ts`) and the runtime lookup
 * MUST derive identical keys, so this helper is the single source of truth.
 */
export function blockI18nKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .join('_')
    .slice(0, 64)
}
