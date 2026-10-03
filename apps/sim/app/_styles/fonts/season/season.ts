import localFont from 'next/font/local'

/**
 * Season Sans variable font configuration
 * Uses variable font file to support any weight from 300-800
 *
 * `display: 'block'`, not `swap`: this is the document font, so a swap is not a cosmetic change of
 * typeface — the fallback's glyph advances differ, so paragraphs re-wrap and everything below them
 * moves. In long-form prose (the Files editor) that reads as the line and paragraph spacing visibly
 * correcting itself a beat after the text appears, on every hard refresh (a normal reload serves the
 * font from cache and never swaps). `swap` is the setting that says "painting the wrong font first is
 * fine"; for a brand face it is not.
 *
 * The block period costs nothing here because delivery is already optimal: `preload` emits a
 * `Link: rel=preload` RESPONSE header, so the fetch starts before the HTML is parsed, and the file is
 * one same-origin, immutably-cached 87KB woff2. The metric-adjusted Arial below stays as the safety
 * net for the >3s tail, where the browser gives up blocking and swaps — i.e. the worst case is
 * today's behavior, not a regression.
 */
export const season = localFont({
  src: [
    // Variable font - supports all weights from 300 to 800
    { path: './SeasonSansUprightsVF.woff2', weight: '300 800', style: 'normal' },
  ],
  display: 'block',
  preload: true,
  variable: '--font-season',
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans'],
  adjustFontFallback: 'Arial',
})
