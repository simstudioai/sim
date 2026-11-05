'use client'

import { useEffect, useState } from 'react'
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
  if (item.account) return 'Your accounts'
  if (item.availability === 'ready' && item.connectableMethod) return 'Available to connect'
  return 'Managed by your organization'
}

export function IntegrationList({ integrations, secrets }: IntegrationListProps) {
  const params = useSearchParams()
  const [query, setQuery] = useState(() => params.get('q') ?? '')
  useEffect(() => {
    const committed = params.get('q') ?? ''
    if (committed === (new URLSearchParams(window.location.search).get('q') ?? '')) {
      setQuery(committed)
    }
  }, [params])
  const term = query.trim().toLowerCase()
  const entries = integrations.map((item) => ({
    id: item.providerId,
    name: item.name,
    detail: item.description,
    status: item.availability === 'managed' && !item.account ? undefined : memberStatus(item),
    section: sectionFor(item),
    searchable: [item.name, item.description, item.account?.label].join(' ').toLowerCase(),
  }))
  if (secrets) {
    const managed = secrets.mode === 'organization'
    entries.push({
      id: 'secrets',
      name: secrets.name,
      detail: secrets.description,
      status: undefined,
      section: managed
        ? 'Managed by your organization'
        : secrets.names.length
          ? 'Your accounts'
          : 'Available to connect',
      searchable: `${secrets.name} ${secrets.description}`.toLowerCase(),
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

  function updateQuery(next: string) {
    const url = new URL(window.location.href)
    if (next) url.searchParams.set('q', next)
    else url.searchParams.delete('q')
    window.history.replaceState(null, '', url)
    setQuery(next)
  }
  return (
    <div className={styles.list}>
      <SearchField
        label='Search integrations'
        placeholder='Search integrations…'
        value={query}
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
                  href={memberIntegrationHref(`/integrations/${item.id}`, params, query)}
                  leading={
                    item.id === 'secrets' ? <Icon name='I070' /> : <Icon providerId={item.id} />
                  }
                  title={item.name}
                  detail={item.detail}
                  metadata={item.status}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
