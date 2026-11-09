import { redirect } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { surfaceHref } from '@/platform/lib/data/organization-model'

/** An organization's bare URL opens the first page the viewer has there. */
export default async function Page({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params
  if (resolvePlatformMode() !== 'live')
    redirect(surfaceHref({ routePrefix: `/o/${organizationId}` }, '/home'))
  const [{ readOrganizationSurface }, { followProductRoute, productLocation }] = await Promise.all([
    import('@/platform/lib/data/surface'),
    import('@/platform/lib/data/route-resolution'),
  ])
  const surface = await readOrganizationSurface(organizationId)
  // The layout already rendered this outcome's denial or error state.
  if (surface.status !== 'ok') return null
  await followProductRoute(
    surface.organization,
    productLocation(surface.organization.routePrefix, {})
  )
  return null
}
