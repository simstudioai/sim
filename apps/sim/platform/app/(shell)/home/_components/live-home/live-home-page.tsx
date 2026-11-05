import { HydrationBoundary } from '@tanstack/react-query'
import { redirect } from 'next/navigation'
import { LiveHome } from '@/platform/app/(shell)/home/_components/live-home/live-home'
import { resolveHomeRedirect } from '@/platform/lib/data/organization-model'
import { prefetchHome } from '@/platform/lib/data/prefetch-home'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

/** The live Home entry: the legacy page's gate, then its cheap reads for first paint. */
export async function LiveHomePage() {
  const surface = await readOrganizationSurface()
  // The layout already rendered this outcome's login, denial or error state.
  if (surface.status !== 'ok') return null
  const destination = resolveHomeRedirect(surface.organization)
  if (destination) redirect(destination)
  return (
    <HydrationBoundary state={await prefetchHome(surface.organization)}>
      <LiveHome />
    </HydrationBoundary>
  )
}
