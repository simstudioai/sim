'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { WorkspaceListOrganizationContext } from '@/hooks/queries/utils/workspace-list-organization'
import { useSeedDeploymentShape } from '@/hooks/use-seed-deployment-shape'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'

const OrganizationContext = createContext<PlatformOrganization | null>(null)

interface OrganizationProviderProps {
  organization: PlatformOrganization
  children: ReactNode
}

/**
 * The viewer's organization, resolved by the server layout. Seeds the deployment shape before any
 * child renders: this app's root layout does not make `env-flags` trustworthy in the browser. The
 * workspace list reads its organization from here, as the shell's server render seeded it.
 */
export function OrganizationProvider({ organization, children }: OrganizationProviderProps) {
  useSeedDeploymentShape(organization.deployment)
  return (
    <OrganizationContext.Provider value={organization}>
      <WorkspaceListOrganizationContext.Provider value={organization.organization.id}>
        {children}
      </WorkspaceListOrganizationContext.Provider>
    </OrganizationContext.Provider>
  )
}

export function useOrganization(): PlatformOrganization {
  const organization = useContext(OrganizationContext)
  if (!organization) throw new Error('useOrganization must be used within OrganizationProvider')
  return organization
}
