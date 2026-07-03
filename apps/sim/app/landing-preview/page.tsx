import Landing from '@/app/(landing)/landing'

/**
 * TEMPORARY preview route — renders the new `(landing)` page at a path that
 * bypasses the self-hosted `/` -> `/login` redirect (proxy only redirects `/`).
 * Local-only scaffold for visual iteration; delete before committing.
 */
export const dynamic = 'force-dynamic'

export default function LandingPreviewPage() {
  return <Landing />
}
