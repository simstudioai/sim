'use client'

import type { ReactNode } from 'react'
import { Surface } from '@sim/emcn-platform/surface'
import dynamic from 'next/dynamic'
import { SimLinkOrganizationProvider } from '@/components/sim-links/sim-link-organization-provider'

/** Every organization route mounts this provider; only a new-link shortcut needs the form. */
const LinkEditor = dynamic(() =>
  import('@/platform/embedded/app/(shell)/links/_components/links-page/link-editor').then(
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
        <Surface>
          <LinkEditor {...form} />
        </Surface>
      )}
    >
      {children}
    </SimLinkOrganizationProvider>
  )
}
