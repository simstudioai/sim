'use client'

import { useSearchParams } from 'next/navigation'
import { ConnectionSettings } from '@/platform/app/(shell)/integrations/_components/connection-settings/connection-settings'
import styles from '@/platform/app/(shell)/integrations/_components/integration-details/integration-details.module.css'
import { IntegrationPeople } from '@/platform/app/(shell)/integrations/_components/integration-people/integration-people'
import { PersonalAccounts } from '@/platform/app/(shell)/integrations/_components/personal-accounts/personal-accounts'
import { SearchSettings } from '@/platform/app/(shell)/integrations/_components/search-settings/search-settings'
import { DestinationTabs, EmptyState } from '@/platform/design-system/components'
import type {
  IntegrationProvider,
  OrganizationIntegration,
} from '@/platform/lib/integrations/model'

interface IntegrationDetailsProps {
  provider: IntegrationProvider
  integration: OrganizationIntegration
  canManage: boolean
  onChange: (next: OrganizationIntegration) => void
  onRemove: () => void
}

export function IntegrationDetails({
  provider,
  integration,
  canManage,
  onChange,
  onRemove,
}: IntegrationDetailsProps) {
  const search = useSearchParams()
  const accounts = Boolean(integration.accountMethods.length || integration.accounts.length)
  const views = [
    ...(provider.searchModes.length ? [{ id: 'search', label: 'Search' }] : []),
    ...(accounts ? [{ id: 'accounts', label: 'Your accounts' }] : []),
    ...(canManage && integration.accountMethods.length ? [{ id: 'people', label: 'People' }] : []),
    ...(canManage ? [{ id: 'settings', label: 'Settings' }] : []),
  ].map((section, index) => {
    const query = new URLSearchParams(search)
    if (index === 0) query.delete('view')
    else query.set('view', section.id)
    return { ...section, href: `/integrations/${provider.id}${query.size ? `?${query}` : ''}` }
  })
  const selected = views.find((section) => section.id === search.get('view')) ?? views[0]
  if (!selected) return <EmptyState title='No account connections available' />
  return (
    <div className={styles.sections}>
      {views.length > 1 && (
        <DestinationTabs
          label={`${provider.name} sections`}
          currentHref={selected.href}
          destinations={views}
        />
      )}
      {selected.id === 'search' && (
        <SearchSettings
          provider={provider}
          integration={integration}
          canManage={canManage}
          onChange={onChange}
        />
      )}
      {selected.id === 'accounts' && (
        <PersonalAccounts provider={provider} integration={integration} onChange={onChange} />
      )}
      {selected.id === 'people' && (
        <IntegrationPeople integration={integration} onChange={onChange} />
      )}
      {selected.id === 'settings' && (
        <ConnectionSettings
          provider={provider}
          integration={integration}
          onChange={onChange}
          onRemove={onRemove}
        />
      )}
    </div>
  )
}
