import localFont from 'next/font/local'

/**
 * Season Sans variable font — the platform's UI font, mirrored from
 * `apps/sim/app/_styles/fonts/season/season.ts` so docs chip chrome renders
 * with the same typeface as the main app. Variable font supports weights
 * 300-800.
 */
export const season = localFont({
  src: [{ path: './SeasonSansUprightsVF.woff2', weight: '300 800', style: 'normal' }],
  display: 'swap',
  preload: true,
  variable: '--font-season',
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans'],
  adjustFontFallback: 'Arial',
})
