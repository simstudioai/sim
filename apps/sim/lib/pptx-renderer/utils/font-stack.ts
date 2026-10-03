/**
 * Builds a CSS font-family stack for a typeface named inside a pptx. Deck
 * fonts frequently exist only on the machine that authored the file (Office's
 * Calibri/Cambria ship with Windows, brand fonts with a designer), and a bare
 * one-name font-family silently falls back to the page default — every deck
 * then previews in the same face. Appending metric-compatible substitutes and
 * a generic family keeps the preview faithful to the deck's intent on
 * machines without the exact font.
 */

const CSS_FONT_KEYWORDS = new Set(['system-ui', 'sans-serif', 'serif', 'monospace'])

/** Metric-compatible or visually close substitutes, keyed by lowercase name. */
const FONT_SUBSTITUTES: Record<string, readonly string[]> = {
  calibri: ['Carlito', 'Helvetica Neue', 'Arial'],
  'calibri light': ['Carlito', 'Helvetica Neue', 'Arial'],
  cambria: ['Caladea', 'Georgia'],
  'segoe ui': ['system-ui', 'Helvetica Neue'],
  arial: ['Helvetica Neue', 'Liberation Sans'],
  helvetica: ['Helvetica Neue', 'Arial'],
  'times new roman': ['Liberation Serif', 'Times'],
  'courier new': ['Liberation Mono', 'Courier'],
  consolas: ['Menlo', 'Liberation Mono'],
  candara: ['Trebuchet MS'],
  constantia: ['Georgia'],
}

const MONO_HINTS = ['mono', 'courier', 'consolas', 'menlo', 'code']
const SERIF_HINTS = [
  'times',
  'georgia',
  'garamond',
  'cambria',
  'caladea',
  'palatino',
  'antiqua',
  'baskerville',
  'didot',
  'bodoni',
  'playfair',
  'merriweather',
  'charter',
  'minion',
  'serif',
]

function genericFamilyFor(family: string): string {
  const lower = family.toLowerCase()
  if (lower.includes('sans')) return 'sans-serif'
  if (MONO_HINTS.some((hint) => lower.includes(hint))) return 'monospace'
  if (SERIF_HINTS.some((hint) => lower.includes(hint))) return 'serif'
  return 'sans-serif'
}

export function cssFontStack(family: string): string {
  const trimmed = family.trim()
  if (!trimmed) return ''
  // Already a stack (or the output of this function) — pass through unchanged.
  if (trimmed.includes(',')) return trimmed
  const names = [trimmed, ...(FONT_SUBSTITUTES[trimmed.toLowerCase()] ?? [])]
  const parts: string[] = []
  for (const name of names) {
    const css = CSS_FONT_KEYWORDS.has(name) ? name : `"${name}"`
    if (!parts.includes(css)) parts.push(css)
  }
  const generic = genericFamilyFor(trimmed)
  if (!parts.includes(generic)) parts.push(generic)
  return parts.join(', ')
}
