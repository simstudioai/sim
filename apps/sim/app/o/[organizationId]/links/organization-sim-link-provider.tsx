'use client'

import type { ReactNode } from 'react'
import { RedesignSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import { SimLinkOrganizationProvider } from '@/app/o/[organizationId]/links/sim-link-organization-provider'
import { LinkEditor } from '@/platform/app/(shell)/links/_components/links-page/link-editor'

interface OrganizationSimLinkProviderProps {
  organizationId: string | null
  children: ReactNode
}

/** The shortcuts' scope on the organization surface, whose new-link form is the Links page's. */
export function OrganizationSimLinkProvider({
  organizationId,
  children,
}: OrganizationSimLinkProviderProps) {
  return (
    <SimLinkOrganizationProvider
      organizationId={organizationId}
      renderForm={(form) => (
        <RedesignSurface>
          <LinkEditor {...form} />
        </RedesignSurface>
      )}
    >
      {children}
    </SimLinkOrganizationProvider>
  )
}
