'use client'

import { createContext, type ReactNode, useContext } from 'react'
import { useSeedDeploymentShape } from '@/hooks/use-seed-deployment-shape'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'

const OrganizationContext = createContext<PlatformOrganization | null>(null)

interface OrganizationProviderProps {
  organization: PlatformOrganization
  children: ReactNode
}

/**
 * The viewer's organization, resolved by the server layout. Seeds the deployment shape before any
 * child renders: this app's root layout does not make `env-flags` trustworthy in the browser.
 */
export function OrganizationProvider({ organization, children }: OrganizationProviderProps) {
  useSeedDeploymentShape(organization.deployment)
  return (
    <OrganizationContext.Provider value={organization}>{children}</OrganizationContext.Provider>
  )
}

export function useOrganization(): PlatformOrganization {
  const organization = useContext(OrganizationContext)
  if (!organization) throw new Error('useOrganization must be used within OrganizationProvider')
  return organization
}
