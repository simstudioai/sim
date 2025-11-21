import localFont from 'next/font/local'

/**
 * Season Sans variable font configuration
 * Uses variable font file to support any weight from 300-800
 */
export const season = localFont({
  src: [
    // Variable font - supports all weights from 300 to 800
    { path: './SeasonSansUprightsVF.woff2', weight: '300 800', style: 'normal' },
  ],
  display: 'swap',
  preload: true,
  variable: '--font-season',
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans'],
  adjustFontFallback: 'Arial',
})
