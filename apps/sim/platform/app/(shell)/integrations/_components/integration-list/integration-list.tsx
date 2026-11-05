'use client'

import { useSearchParams } from 'next/navigation'
import styles from '@/platform/app/(shell)/integrations/_components/integration-list/integration-list.module.css'
import { ActivityRow, EmptyState, Icon, SearchField } from '@/platform/design-system/components'
import type { MemberSecretSource } from '@/platform/lib/integrations/member-secret-source'
import {
  memberIntegrationHref,
  memberStatus,
  type OrganizationIntegration,
} from '@/platform/lib/integrations/model'

interface IntegrationListProps {
  integrations: readonly OrganizationIntegration[]
  secrets: MemberSecretSource | null
}

const SECTIONS = ['Your accounts', 'Available to connect', 'Managed by your organization'] as const
type Section = (typeof SECTIONS)[number]

function sectionFor(item: OrganizationIntegration): Section {
  if (item.accounts.length) return 'Your accounts'
  if (item.availability === 'ready' && item.connectableMethod) return 'Available to connect'
  return 'Managed by your organization'
}

export function IntegrationList({ integrations, secrets }: IntegrationListProps) {
  const params = useSearchParams()
  const query = params.get('q') ?? ''
  const term = query.trim().toLowerCase()
  const entries = integrations.map((item) => ({
    id: item.providerId,
    name: item.name,
    detail: memberStatus(item),
    section: sectionFor(item),
    searchable: [item.name, ...item.accounts.map(({ label }) => label)].join(' ').toLowerCase(),
  }))
  if (secrets) {
    const managed = secrets.mode === 'organization'
    entries.push({
      id: 'secrets',
      name: 'Generic Secrets',
      detail: managed ? 'Organization managed' : 'Personal secrets',
      section: managed
        ? 'Managed by your organization'
        : secrets.names.length
          ? 'Your accounts'
          : 'Available to connect',
      searchable: 'generic secrets',
    })
  }
  if (!entries.length)
    return (
      <EmptyState
        title='No integrations available'
        description='Apps enabled for your organization will appear here.'
      />
    )
  const matches = entries.filter((entry) => entry.searchable.includes(term))
  function updateQuery(value: string) {
    const url = new URL(window.location.href)
    if (value) url.searchParams.set('q', value)
    else url.searchParams.delete('q')
    window.history.replaceState(null, '', url)
  }
  return (
    <div className={styles.list}>
      <SearchField
        label='Search integrations'
        placeholder='Search integrations…'
        defaultValue={query}
        onValueChange={updateQuery}
      />
      {matches.length === 0 && <EmptyState title='No matching integrations' />}
      {SECTIONS.map((section) => {
        const items = matches.filter((item) => item.section === section)
        if (!items.length) return null
        return (
          <section key={section} className={styles.group} aria-label={section}>
            <h2 data-type='T059'>{section}</h2>
            <ul className={styles.rows}>
              {items.map((item) => (
                <ActivityRow
                  key={item.id}
                  href={memberIntegrationHref(`/integrations/${item.id}`, params)}
                  leading={
                    item.id === 'secrets' ? <Icon name='I070' /> : <Icon providerId={item.id} />
                  }
                  title={item.name}
                  detail={item.detail}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
