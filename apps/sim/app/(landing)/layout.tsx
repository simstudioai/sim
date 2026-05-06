import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/core/utils/urls'
import { martianMono } from '@/app/_styles/fonts/martian-mono/martian-mono'
import { season } from '@/app/_styles/fonts/season/season'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml', sizes: 'any' }],
    apple: '/favicon/apple-touch-icon.png',
  },
  other: {
    'msapplication-TileColor': '#000000',
    'theme-color': '#000000',
  },
}

/** Opt the landing segment out of static prerendering so client components like
 * Navbar render with the live runtime env (e.g. Docker-injected `NEXT_PUBLIC_BRAND_*`)
 * during SSR, avoiding hydration mismatches against `window.__ENV`. */
export const dynamic = 'force-dynamic'

/**
 * Landing page route-group layout.
 *
 * Applies landing-specific font CSS variables to the subtree:
 * - `--font-season` (Season Sans): Headings and display text
 * - `--font-martian-mono` (Martian Mono): Code snippets and technical accents
 *
 * Available to child components via Tailwind (`font-season`, `font-martian-mono`).
 */
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${season.variable} ${martianMono.variable}`}>{children}</div>
}
