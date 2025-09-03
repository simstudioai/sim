import { Inter } from 'next/font/google'

export const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  weight: ['300', '400', '500', '600', '700'],
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans'],
})
