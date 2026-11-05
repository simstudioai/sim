'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import styles from '@/platform/app/(shell)/integrations/_components/integration-list/integration-list.module.css'
import { ActivityRow, EmptyState, SearchField, Select } from '@/platform/design-system/components'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { platformHref } from '@/platform/design-system/navigation'
import type {
  IntegrationProvider,
  OrganizationIntegration,
} from '@/platform/lib/integrations/model'

interface IntegrationListProps {
  providers: readonly IntegrationProvider[]
  configured: ReadonlyMap<string, OrganizationIntegration>
  canManage: boolean
}

function attention(item: OrganizationIntegration, canManage: boolean) {
  if (item.accounts.some((account) => account.status === 'needs_reauth')) return 'Reconnect account'
  if (!canManage || item.searchMode !== 'service_account') return null
  const scopedByProject = item.providerId === 'github' || item.providerId === 'gitlab'
  const sources = item.sources.filter(
    (source) => !source.draft && (scopedByProject || source.id === item.sourceId)
  )
  if (!sources.length) return 'Set up source'
  if (!sources.some((source) => source.available)) return 'Source unavailable'
  if (!sources.some((source) => source.available && source.enabled)) return 'Source paused'
  return null
}

const filters = ['All apps', 'Search', 'Accounts'] as const

function connectionSummary(item: OrganizationIntegration, provider: IntegrationProvider) {
  if (item.searchMode === 'service_account') {
    const sources = item.sources.filter(
      (source) =>
        !source.draft && (source.id === item.sourceId || ['github', 'gitlab'].includes(provider.id))
    )
    if (sources.length) return sources.map((source) => source.label).join(' · ')
  }
  if (item.accounts.length) return item.accounts.map((account) => account.label).join(' · ')
  if (item.searchApproved && item.searchMode === 'member') return 'Uses each member’s account'
  return item.label || provider.description
}

export function IntegrationList({ providers, configured, canManage }: IntegrationListProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<(typeof filters)[number]>('All apps')
  const search = useSearchParams()
  if (!configured.size)
    return (
      <EmptyState
        title='No integrations added'
        description='Apps added to your organization will appear here.'
      />
    )
  const term = query.trim().toLowerCase()
  const matches = providers.flatMap((provider) => {
    const item = configured.get(provider.id)
    if (!item) return []
    const detail = connectionSummary(item, provider)
    if (!`${provider.name} ${provider.description} ${detail}`.toLowerCase().includes(term))
      return []
    if (
      (filter === 'Search' && !item.searchMode) ||
      (filter === 'Accounts' && !item.accountMethods.length)
    )
      return []
    const use = [item.searchMode && 'Search', item.accountMethods.length > 0 && 'Accounts']
      .filter(Boolean)
      .join(' · ')
    return [
      {
        provider,
        detail,
        status: attention(item, canManage),
        use,
      },
    ]
  })
  return (
    <div className={styles.list}>
      <div className={styles.filters}>
        <SearchField
          label='Find an integration'
          placeholder='Find an integration…'
          onValueChange={setQuery}
        />
        <div className={styles.filterChoice}>
          <Select
            variant='quiet'
            label='Filter integrations by use'
            value={filter}
            options={filters.map((name) => ({ value: name, label: name }))}
            onValueChange={(value) =>
              setFilter(filters.find((name) => name === value) ?? 'All apps')
            }
          />
        </div>
      </div>
      {matches.length === 0 ? (
        <EmptyState title='No matching integrations' />
      ) : (
        [true, false].map((needsAttention) => {
          const rows = matches.filter((entry) => Boolean(entry.status) === needsAttention)
          if (!rows.length) return null
          const title = needsAttention ? 'Needs attention' : 'Configured apps'
          return (
            <section key={title} className={styles.group} aria-label={title}>
              <h2 data-type='T059'>{title}</h2>
              <ul className={styles.rows}>
                {rows.map(({ provider, detail, status, use }) => (
                  <ActivityRow
                    key={provider.id}
                    href={platformHref(`/integrations/${provider.id}`, search)}
                    leading={<Icon providerId={provider.id} />}
                    title={provider.name}
                    detail={detail}
                    metadata={status ?? use}
                  />
                ))}
              </ul>
            </section>
          )
        })
      )}
    </div>
  )
}
