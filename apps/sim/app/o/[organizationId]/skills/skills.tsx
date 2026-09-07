'use client'

import { useMemo } from 'react'
import {
  OrganizationPage,
  type OrganizationPageTab,
} from '@/app/o/[organizationId]/components/organization-page'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'

/** The organization's skills, filtered to everyone's, the viewer's own, or the organization's shared set. */
export function Skills() {
  const { organization } = useOrganizationContext()

  const tabs = useMemo<OrganizationPageTab[]>(
    () => [
      { id: 'all', label: 'All' },
      { id: 'mine', label: 'Mine' },
      { id: 'organization', label: organization.name },
    ],
    [organization.name]
  )

  return (
    <OrganizationPage
      title='Skills'
      description='Reusable instructions Sim can use'
      tabs={tabs}
      action='Create skill'
    />
  )
}
