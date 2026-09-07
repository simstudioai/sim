import type { Metadata } from 'next'
import { OrganizationPage } from '@/app/o/[organizationId]/components/organization-page'

export const metadata: Metadata = {
  title: 'Workspaces',
}

/** Workspaces by the viewer's permission level in each. */
const TABS = [
  { id: 'all', label: 'All' },
  { id: 'admin', label: 'Admin' },
  { id: 'write', label: 'Write' },
  { id: 'read', label: 'Read' },
] as const

export default function OrganizationWorkspacesPage() {
  return (
    <OrganizationPage
      title='Workspaces'
      description='Where your team builds agents and workflows'
      tabs={TABS}
      action='Create workspace'
    />
  )
}
