import { HydrationBoundary } from '@tanstack/react-query'
import { LiveHome } from '@/app/(product)/o/[organizationId]/home/_components/live-home/live-home'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { prefetchHome } from '@/platform/lib/data/prefetch-home'
import { followProductRoute, productLocation } from '@/platform/lib/data/route-resolution'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

interface LiveHomeRouteProps {
  searchParams: Record<string, string | string[] | undefined>
}

/** The live Home entry: the legacy page's gate, then its cheap reads for first paint. */
export async function LiveHomeRoute({ searchParams }: LiveHomeRouteProps) {
  const surface = await readOrganizationSurface()
  // The layout already rendered this outcome's login, denial or error state.
  if (surface.status !== 'ok') return null
  await followProductRoute(
    surface.organization,
    productLocation(surfaceHref(surface.organization, '/home'), searchParams)
  )
  return (
    <HydrationBoundary state={await prefetchHome(surface.organization)}>
      <LiveHome />
    </HydrationBoundary>
  )
}
