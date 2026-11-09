'use client'

import { type ReactNode, useEffect } from 'react'
import { useOrganization } from '@/platform/lib/data/organization'

interface ShellOrganizationGuardProps {
  /** The organization the page under this guard belongs to. */
  organizationId: string
  children: ReactNode
}

/**
 * The shell keeps its organization across client navigations, since the product root layout does
 * not render again. A page in another organization reloads the document instead, so the shell,
 * its navigation and its caches all belong to that organization.
 */
export function ShellOrganizationGuard({ organizationId, children }: ShellOrganizationGuardProps) {
  const crossesOrganization = useOrganization().organization.id !== organizationId
  useEffect(() => {
    if (crossesOrganization) window.location.reload()
  }, [crossesOrganization])
  return crossesOrganization ? null : children
}
