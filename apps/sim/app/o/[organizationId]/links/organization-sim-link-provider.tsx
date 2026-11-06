'use client'

import type { ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { RedesignSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import { SimLinkOrganizationProvider } from '@/app/o/[organizationId]/links/sim-link-organization-provider'

/** Every organization route mounts this provider; only a new-link shortcut needs the form. */
const LinkEditor = dynamic(() =>
  import('@/platform/app/(shell)/links/_components/links-page/link-editor').then(
    (module) => module.LinkEditor
  )
)

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
