import localFont from 'next/font/local'

export const soehne = localFont({
  src: [
    // Light (leicht)
    { path: './soehne-leicht.woff2', weight: '300', style: 'normal' },
    { path: './soehne-leicht-kursiv.woff2', weight: '300', style: 'italic' },
    // Regular (buch)
    { path: './soehne-buch.woff2', weight: '400', style: 'normal' },
    { path: './soehne-buch-kursiv.woff2', weight: '400', style: 'italic' },
    // Medium (kräftig)
    { path: './soehne-kraftig.woff2', weight: '500', style: 'normal' },
    { path: './soehne-kraftig-kursiv.woff2', weight: '500', style: 'italic' },
    // Semibold (halbfett)
    { path: './soehne-halbfett.woff2', weight: '600', style: 'normal' },
    { path: './soehne-halbfett-kursiv.woff2', weight: '600', style: 'italic' },
    // Bold (dreiviertelfett)
    { path: './soehne-dreiviertelfett.woff2', weight: '700', style: 'normal' },
    { path: './soehne-dreiviertelfett-kursiv.woff2', weight: '700', style: 'italic' },
  ],
  display: 'swap',
  preload: true,
  variable: '--font-soehne',
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans'],
  adjustFontFallback: 'Arial',
})
