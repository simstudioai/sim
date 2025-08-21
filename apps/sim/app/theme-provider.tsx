'use client'

import type { ThemeProviderProps } from 'next-themes'
import { ThemeProvider as NextThemesProvider } from 'next-themes'

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute='class'
      defaultTheme='system'
      enableSystem
      disableTransitionOnChange
      storageKey='theme-preference'
      enableColorScheme={false}
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
