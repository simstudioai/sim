'use client'

import { usePathname } from 'next/navigation'
import type { ThemeProviderProps } from 'next-themes'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

export function ConditionalThemeProvider({ children, ...props }: ThemeProviderProps) {
  const pathname = usePathname()

  // Force light mode for landing page (root path and /homepage)
  const forcedTheme = pathname === '/' || pathname === '/homepage' ? 'light' : undefined

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
