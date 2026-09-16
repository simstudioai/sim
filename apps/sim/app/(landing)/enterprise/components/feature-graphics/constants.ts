import type { CSSProperties } from 'react'

/**
 * Loader ink for the tiles' inverse grounds - the dark Deploy button and the
 * charcoal router hub on the light page, both of which turn light once the
 * page goes dark. The loader there takes the *opposite* theme's thinking-loader
 * ink, because the page theme would otherwise ink it to match the very ground
 * it sits on: light grey (the `.dark` tokens) on the light page, the page's own
 * dark ink (the `.light` tokens) in dark mode. Literals, because no token names
 * the other theme's ink; {@link INVERSE_LOADER_INK_CLASS} carries the pair as
 * custom properties and {@link INVERSE_LOADER_INK_STYLE} points the loader at
 * them.
 */
export const INVERSE_LOADER_INK_CLASS =
  '[--inverse-ink-inner:#a7a7a7] [--inverse-ink-outer:#d6d6d6] [--inverse-ink-glow:rgba(255,255,255,0.9)] dark:[--inverse-ink-inner:#2c2c2c] dark:[--inverse-ink-outer:#5f5f5f] dark:[--inverse-ink-glow:rgba(255,255,255,0.6)]'

export const INVERSE_LOADER_INK_STYLE = {
  '--tl-grad-inner': 'var(--inverse-ink-inner)',
  '--tl-grad-outer': 'var(--inverse-ink-outer)',
  '--tl-glow': 'var(--inverse-ink-glow)',
} as CSSProperties
