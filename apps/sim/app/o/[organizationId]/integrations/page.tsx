import type { Metadata } from 'next'
import { OrganizationPage } from '@/app/o/[organizationId]/components/organization-page'

export const metadata: Metadata = {
  title: 'Integrations',
}

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
] as const

export default function OrganizationIntegrationsPage() {
  return (
    <OrganizationPage
      title='Integrations'
      description='Connect your tools for Sim Search'
      tabs={TABS}
    />
  )
}
