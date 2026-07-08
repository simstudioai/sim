import { notFound } from 'next/navigation'
import { LandingShell } from '@/app/(landing)/components'
import Landing from '@/app/(landing)/landing'

/**
 * TEMPORARY preview route — renders the new `(landing)` page at a path that
 * bypasses the self-hosted `/` -> `/login` redirect (proxy only redirects `/`).
 * Wrapped in {@link LandingShell} so the preview carries the exact prod chrome
 * (light tokens, navbar with GitHub stars, footer, JSON-LD).
 * Local/preview-only scaffold for visual iteration — 404s in production.
 */
export const dynamic = 'force-dynamic'

export default function LandingPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <LandingShell>
      <Landing />
    </LandingShell>
  )
}
