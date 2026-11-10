import type { ReactNode } from 'react'
import { notFound, redirect } from 'next/navigation'
import { SurfaceUnavailable } from '@/app/(product)/_components/shell-gate/shell-gate'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

interface OrganizationLayoutProps {
  children: ReactNode
  params: Promise<{ organizationId: string }>
}

/**
 * Authorizes the organization the URL names: a viewer outside it gets not found, and a failed read
 * the unavailable state. A client navigation into the organization skips the shell, so the
 * organization gate runs here too, for the location the proxy names (Settings stays reachable).
 */
export default async function OrganizationLayout({ children, params }: OrganizationLayoutProps) {
  if (resolvePlatformMode() !== 'live') return children
  const [
    { organizationId },
    { readOrganizationSurface },
    { readDocumentLocation, resolveOrganizationGate },
  ] = await Promise.all([
    params,
    import('@/platform/lib/data/surface'),
    import('@/platform/lib/data/route-resolution'),
  ])
  const [surface, location] = await Promise.all([
    readOrganizationSurface(organizationId),
    readDocumentLocation(),
  ])
  if (surface.status === 'denied') notFound()
  if (surface.status !== 'ok') return <SurfaceUnavailable />
  const gate = resolveOrganizationGate(surface.organization, location)
  if (gate) redirect(gate)
  return children
}
