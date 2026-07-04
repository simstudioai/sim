import { LandingShell } from '@/app/(landing)/components'
import Landing from '@/app/(landing)/landing'

/**
 * TEMPORARY preview route — renders the new `(landing)` page at a path that
 * bypasses the self-hosted `/` -> `/login` redirect (proxy only redirects `/`).
 * Wrapped in {@link LandingShell} so the preview carries the exact prod chrome
 * (light tokens, navbar with GitHub stars, footer, JSON-LD).
 * Local-only scaffold for visual iteration; delete before committing.
 */
export const dynamic = 'force-dynamic'

export default function LandingPreviewPage() {
  return (
    <LandingShell>
      <Landing />
    </LandingShell>
  )
}
