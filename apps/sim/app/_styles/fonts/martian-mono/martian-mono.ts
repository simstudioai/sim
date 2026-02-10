import { Martian_Mono } from 'next/font/google'

/**
 * Martian Mono font configuration
 * Monospaced variable font used for code snippets, technical content, and accent text
 * on the landing page. Supports weights 100-800.
 */
export const martianMono = Martian_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-martian-mono',
  weight: 'variable',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
})
