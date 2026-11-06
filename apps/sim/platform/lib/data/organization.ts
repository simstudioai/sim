'use client'

import { ANONYMOUS_USER_ID } from '@sim/auth/principal'
import { useSession } from '@/lib/auth/client'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'

/** What a Settings section reads about its organization and viewer. Plain surface data. */
export type PlatformOrganization = OrganizationSurfaceContext

export const useOrganization = useOrganizationContext

/** An auth-disabled deployment's viewer has no account to manage and cannot sign out. */
export function useAnonymousViewer() {
  const { data: session } = useSession()
  return session?.user?.id === ANONYMOUS_USER_ID
}
