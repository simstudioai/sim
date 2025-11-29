'use client'

import { usePathname } from 'next/navigation'
import type { ThemeProviderProps } from 'next-themes'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  const pathname = usePathname()

  // Force dark mode for workspace pages and templates
  // Force light mode for certain public pages
  const forcedTheme =
    pathname.startsWith('/workspace') || pathname.startsWith('/templates')
      ? 'dark'
      : pathname === '/' ||
          pathname.startsWith('/login') ||
          pathname.startsWith('/signup') ||
          pathname.startsWith('/sso') ||
          pathname.startsWith('/terms') ||
          pathname.startsWith('/privacy') ||
          pathname.startsWith('/invite') ||
          pathname.startsWith('/verify') ||
          pathname.startsWith('/careers') ||
          pathname.startsWith('/changelog') ||
          pathname.startsWith('/chat') ||
          pathname.startsWith('/studio')
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
