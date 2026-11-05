'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { mapLegacyOrganizationUrl } from '@/lib/platform/routes'

interface PlatformRouteGuardProps {
  organizationId: string
}

/**
 * For an organization on the Platform, the layout only renders routes that stayed legacy, and it
 * does not re-render on client navigation. This sends a link from one of those pages to a route the
 * Platform owns. A full navigation, because the Platform is a different application.
 */
export function PlatformRouteGuard({ organizationId }: PlatformRouteGuardProps) {
  const pathname = usePathname()
  const search = useSearchParams().toString()
  useEffect(() => {
    const url = search ? `${pathname}?${search}` : pathname
    const platformUrl = mapLegacyOrganizationUrl(url, organizationId)
    if (platformUrl) window.location.replace(platformUrl)
  }, [pathname, search, organizationId])
  return null
}
