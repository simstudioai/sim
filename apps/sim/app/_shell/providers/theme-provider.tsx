'use client'

import { useState } from 'react'
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
 * `AuthShell` and the rest pin `light` on a wrapper *inside* the page, which
 * leaves `<html>` on the visitor's theme. Forcing the theme here puts the same
 * layer on `<html>`, so root-level chrome — scrollbars, `color-scheme`, and
 * anything portalled to `<body>` such as the cookie consent banner — matches
 * the page it sits on instead of contradicting it.
 */
const LIGHT_MODE_SEGMENTS: ReadonlySet<string> = new Set(NON_LANDING_LIGHT_SEGMENTS)

/**
 * The marketing surface: the root plus every `app/(landing)` segment. These
 * pages keep their own stored theme, written only by the landing footer's
 * toggle, so a visitor who has never chosen one there gets light, the landing
 * family's design baseline. The app's `sim-theme` key cannot serve: the
 * workspace's settings sync writes the account default (`system`) into it for
 * every signed-in user, which would render the marketing site in the OS theme
 * and overwrite any choice the footer toggle made.
 */
const LANDING_SEGMENTS: ReadonlySet<string> = new Set(LANDING_ROUTES)

const APP_THEME_STORAGE_KEY = 'sim-theme'
const LANDING_THEME_STORAGE_KEY = 'sim-landing-theme'

function isLandingPath(pathname: string): boolean {
  const firstSegment = pathname.split('/')[1]
  return firstSegment === '' || LANDING_SEGMENTS.has(firstSegment)
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  const pathname = usePathname()

  /**
   * next-themes reads `storageKey` and `defaultTheme` once, at mount and in its
   * pre-hydration script, so both are fixed from the document's first path.
   * Every entry into the marketing surface from another shell is a document
   * navigation (`AuthShell`, `LogoShell`, post-auth redirects), so the choice
   * never needs to change within one document.
   */
  const [surface] = useState(() =>
    isLandingPath(pathname)
      ? { defaultTheme: 'light', storageKey: LANDING_THEME_STORAGE_KEY }
      : { defaultTheme: 'system', storageKey: APP_THEME_STORAGE_KEY }
  )
  const forcedTheme = LIGHT_MODE_SEGMENTS.has(pathname.split('/')[1]) ? 'light' : undefined

  return (
    <NextThemesProvider
      attribute='class'
      defaultTheme={surface.defaultTheme}
      enableSystem
      disableTransitionOnChange
      storageKey={surface.storageKey}
      forcedTheme={forcedTheme}
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
