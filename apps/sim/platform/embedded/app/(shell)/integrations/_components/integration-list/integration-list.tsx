import { SectionSearch } from '@/platform/design-system/components'
import { ActivityRow } from '@/platform/design-system/components/activity-row/activity-row'
import { EmptyState } from '@/platform/design-system/components/empty-state/empty-state'
import { RowList } from '@/platform/design-system/components/settings-section/row-list'
import styles from '@/platform/embedded/app/(shell)/integrations/_components/integration-list/integration-list.module.css'
import { IntegrationMark } from '@/platform/embedded/app/(shell)/integrations/_components/integration-mark/integration-mark'
import {
  type GenericSecrets,
  isConnectable,
  type OrganizationIntegration,
} from '@/platform/shared/integrations'

const SECTIONS = [
  'Your accounts',
  'Available to connect',
  'Managed by your organization',
  'Not available',
] as const
type Section = (typeof SECTIONS)[number]

function sectionFor(item: OrganizationIntegration): Section {
  if (item.accounts.length) return 'Your accounts'
  if (isConnectable(item)) return 'Available to connect'
  return item.availability === 'managed' ? 'Managed by your organization' : 'Not available'
}

interface IntegrationListProps {
  integrations: readonly OrganizationIntegration[]
  secrets: GenericSecrets | null
  query: string
  onQueryChange: (query: string) => void
  integrationHref: (id: string) => string
  secretsHref: string
  /** False while a read could still add rows, so an empty list is not claimed too early. */
  settled: boolean
}

export function IntegrationList({
  integrations,
  secrets,
  query,
  onQueryChange,
  integrationHref,
  secretsHref,
  settled,
}: IntegrationListProps) {
  const term = query.trim().toLowerCase()
  const entries = integrations.map((item) => ({
    id: item.id,
    href: integrationHref(item.id),
    leading: <IntegrationMark providerId={item.providerId} icon={item.icon} />,
    name: item.name,
    detail: item.description,
    status: item.status,
    section: sectionFor(item),
    searchable: [
      item.providerId,
      item.name,
      item.description,
      ...item.accounts.map((account) => account.label),
    ]
      .join(' ')
      .toLowerCase(),
  }))
  if (secrets) {
    const managed = secrets.mode === 'organization'
    entries.push({
      id: 'generic-secrets',
      href: secretsHref,
      leading: <IntegrationMark />,
      name: secrets.name,
      detail: secrets.description,
      status: managed ? 'Organization managed' : 'Personal secrets',
      section: managed ? 'Managed by your organization' : 'Available to connect',
      searchable: `${secrets.name} ${secrets.description}`.toLowerCase(),
    })
  }
  const matches = entries.filter((entry) => entry.searchable.includes(term))
  return (
    <div className={styles.list}>
      <SectionSearch subject='integrations' value={query} onValueChange={onQueryChange} />
      {settled &&
        matches.length === 0 &&
        (term ? (
          <EmptyState title='No matching integrations' />
        ) : (
          <EmptyState title='No integrations available' />
        ))}
      {SECTIONS.map((section) => {
        const items = matches.filter((item) => item.section === section)
        if (!items.length) return null
        return (
          <section key={section} className={styles.group} aria-label={section}>
            <h2 data-type='T059'>{section}</h2>
            <RowList>
              {items.map((item) => (
                <ActivityRow
                  key={item.id}
                  href={item.href}
                  leading={item.leading}
                  title={item.name}
                  detail={item.detail}
                  metadata={item.status}
                />
              ))}
            </RowList>
          </section>
        )
      })}
    </div>
  )
}
