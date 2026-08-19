/**
 * The docs render Inter (their `--font-geist-sans` resolves to Inter via
 * next/font), so generated pages carry the same face. The asset in
 * `public/fonts/` is next/font's own latin variable subset (weights 100–900
 * in one file — the docs use intermediate weights like 430/470/550), copied
 * from the app build's font cache, so the page and the platform serve
 * byte-identical Inter.
 *
 * Two delivery paths, because the preview sandbox allows `font-src data:`
 * only: standalone/share/download documents reference the app-served URL,
 * while the preview host fetches the file once and inlines it as a data: URI.
 */
export const SIM_PAGE_FONT_URL = '/fonts/inter-variable-latin.woff2'

/** One `@font-face` covering Inter's full variable weight range. */
export function simPageFontFace(src: string): string {
  return `@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url(${src}) format("woff2")}`
}
