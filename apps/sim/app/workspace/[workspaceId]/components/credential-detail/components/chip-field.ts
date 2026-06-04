/**
 * Shared chip-field chrome for the credential and secret detail surfaces.
 *
 * These mirror `Input variant='chip'` exactly (30px tall, `rounded-lg`,
 * `border-1`, `surface-5`/`surface-4`, `font-medium` body text, and a
 * `border-focus` ring on focus) but as a wrapper + inner-input pair, so a field
 * can host a borderless input alongside a trailing slot (a copy button, a
 * reveal toggle). Using one definition keeps every chip field — list rows,
 * copyable IDs, secret values, display-name/description editors — pixel-identical
 * to the canonical chip input instead of each re-deriving the tokens.
 */

/** Pill wrapper. Override height/alignment (e.g. a textarea) via `cn`. */
export const CHIP_FIELD_SHELL =
  'flex h-[30px] items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 transition-colors focus-within:border-[var(--border-focus)] dark:bg-[var(--surface-4)]'

/** Borderless input/textarea hosted inside {@link CHIP_FIELD_SHELL}. */
export const CHIP_FIELD_INPUT =
  'h-full w-full bg-transparent font-medium text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)] focus:outline-none'
