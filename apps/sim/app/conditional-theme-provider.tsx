'use client'

import { usePathname } from 'next/navigation'
import type { ThemeProviderProps } from 'next-themes'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

export function ConditionalThemeProvider({ children, ...props }: ThemeProviderProps) {
  const pathname = usePathname()

  // Force light mode for landing page (root path and /homepage), auth pages, and legal pages
  const forcedTheme =
    pathname === '/' ||
    pathname === '/homepage' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/privacy')
      ? 'light'
      : undefined

  return (
    <NextThemesProvider
      attribute='class'
      defaultTheme='system'
      enableSystem
      disableTransitionOnChange
      storageKey='sim-theme'
      forcedTheme={forcedTheme}
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
