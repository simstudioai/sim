'use client'

import { usePathname } from 'next/navigation'
import type { ThemeProviderProps } from 'next-themes'
import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { LANDING_ROUTES } from '@/lib/landing/routes'

/**
 * First path segments outside the `(landing)` group whose pages pin the light
 * token layer in their own shell — `(auth)`, the chat interfaces, the public
 * file view, the pages reached from an email, and the `AuthShell` handoffs for
 * the CLI and credential groups. Segments, not prefixes: they are matched by
 * set membership, so `f` covers `/f/<token>` and needs no trailing slash.
 */
const NON_LANDING_LIGHT_SEGMENTS = [
  'login',
  'signup',
  'reset-password',
  'sso',
  'invite',
  'verify',
  'chat',
  'resume',
  'oauth',
  'oauth-error',
  'f',
  'unsubscribe',
  'cli',
  'credential-groups',
] as const

/**
 * Path segments rendered light regardless of the visitor's theme.
 *
 * `LandingShell`, `AuthShell` and the rest pin `light` on a wrapper *inside* the
 * page, which leaves `<html>` on the visitor's theme. Forcing the theme here
 * puts the same layer on `<html>`, so root-level chrome — scrollbars,
 * `color-scheme`, and anything portalled to `<body>` such as the cookie consent
 * banner — matches the page it sits on instead of contradicting it.
 */
const LIGHT_MODE_SEGMENTS: ReadonlySet<string> = new Set([
  ...LANDING_ROUTES,
  ...NON_LANDING_LIGHT_SEGMENTS,
])

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  const pathname = usePathname()

  const firstSegment = pathname.split('/')[1]
  const forcedTheme =
    firstSegment === '' || LIGHT_MODE_SEGMENTS.has(firstSegment) ? 'light' : undefined

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
