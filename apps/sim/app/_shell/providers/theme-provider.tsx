'use client'

import { usePathname } from 'next/navigation'
import type { ThemeProviderProps } from 'next-themes'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  const pathname = usePathname()

  // Force light mode on public/marketing pages, allow user preference elsewhere
  const isLightModePage =
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/sso') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/invite') ||
    pathname.startsWith('/verify') ||
    pathname.startsWith('/careers') ||
    pathname.startsWith('/changelog') ||
    pathname.startsWith('/chat') ||
    pathname.startsWith('/studio') ||
    pathname.startsWith('/resume') ||
    pathname.startsWith('/form')

  return (
    <NextThemesProvider
      attribute='class'
      defaultTheme='dark'
      enableSystem
      disableTransitionOnChange
      storageKey='sim-theme'
      forcedTheme={isLightModePage ? 'light' : undefined}
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
