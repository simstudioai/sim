import { redirect } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

/** An organization's bare URL opens the first page the viewer has there. */
export default async function Page({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params
  if (resolvePlatformMode() !== 'live') redirect(organizationRoutes(organizationId).home)
  const [{ readOrganizationSurface }, { organizationLandingPath }] = await Promise.all([
    import('@/platform/lib/data/surface'),
    import('@/platform/lib/data/landing'),
  ])
  const surface = await readOrganizationSurface(organizationId)
  // The layout already rendered this outcome's denial or error state.
  if (surface.status !== 'ok') return null
  redirect(organizationLandingPath(surface.organization))
}
