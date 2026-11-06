import { IntegrationMark } from '@/platform/app/(shell)/integrations/_components/integration-mark/integration-mark'
import styles from '@/platform/app/(shell)/integrations/_components/resource-list/resource-list.module.css'
import { ActivityRow, Avatar, Icon } from '@/platform/design-system/components'
import type { AppSummary, IntegrationResource } from '@/platform/lib/integrations/center-model'
import { credentialDescription } from '@/platform/lib/integrations/credential-display'

interface AppGroupProps {
  title: string
  apps: readonly AppSummary[]
  onNavigate: (href: string) => void
}

export function AppGroup({ title, apps, onNavigate }: AppGroupProps) {
  if (!apps.length) return null
  return (
    <section className={styles.group} aria-label={title}>
      <h2 data-type='T059'>{title}</h2>
      <ul className={styles.rows}>
        {apps.map((app) => (
          <AppEntry key={app.id} app={app} onNavigate={onNavigate} />
        ))}
      </ul>
    </section>
  )
}

interface AppEntryProps {
  app: AppSummary
  onNavigate: (href: string) => void
}

function AppEntry({ app, onNavigate }: AppEntryProps) {
  const people = app.scope || app.connected ? [] : (app.people ?? []).slice(0, 3)
  const total = Math.max(app.peopleTotal ?? 0, app.people?.length ?? 0)
  const others = Math.max(0, total - people.length)
  const usage =
    !app.scope && !app.connected && total > 0
      ? `Used by ${people.map((person) => person.name).join(', ')}${
          others > 0
            ? people.length
              ? `, and ${others} ${others === 1 ? 'other' : 'others'}`
              : `${others} ${others === 1 ? 'person' : 'people'}`
            : ''
        }`
      : undefined
  const detail =
    !app.scope && app.connected && app.credentialCount !== undefined
      ? `${app.credentialCount} connected ${app.credentialCount === 1 ? 'credential' : 'credentials'}`
      : (usage ?? app.description)
  return (
    <ActivityRow
      href={app.href}
      onNavigate={(event) => {
        event.preventDefault()
        onNavigate(app.href)
      }}
      leading={<IntegrationMark providerId={app.providerId ?? app.id} icon={app.icon} />}
      title={app.name}
      detail={detail}
      detailContent={
        usage && people.length > 0 ? (
          <span className={styles.usage}>
            Used by{' '}
            {people.map((person, index) => (
              <span key={person.id} className={styles.person}>
                <span aria-hidden>
                  <Avatar name={person.name} src={person.src} size='inline' />
                </span>
                <span>
                  {person.name}
                  {index < people.length - 1 || others > 0 ? ',' : ''}
                </span>
              </span>
            ))}
            {others > 0 && (
              <span>
                and {others} {others === 1 ? 'other' : 'others'}
              </span>
            )}
          </span>
        ) : undefined
      }
    />
  )
}

interface ResourceGroupProps {
  title: string
  resources: readonly IntegrationResource[]
  links?: readonly AppSummary[]
  order: 'asc' | 'desc'
  onNavigate: (href: string) => void
  onOpen: (resource: IntegrationResource) => void
}

export function ResourceGroup({
  title,
  resources,
  links = [],
  order,
  onNavigate,
  onOpen,
}: ResourceGroupProps) {
  if (!resources.length && !links.length) return null
  const entries = [...resources, ...links].sort(
    (a, b) => (order === 'asc' ? 1 : -1) * a.name.localeCompare(b.name)
  )
  return (
    <section className={styles.group} aria-label={title}>
      <h2 data-type='T059'>{title}</h2>
      <ul className={styles.rows}>
        {entries.map((resource) =>
          'kind' in resource ? (
            <ActivityRow
              key={resource.id}
              leading={
                <Icon
                  name={
                    resource.kind === 'skill' ? 'I044' : resource.kind === 'mcp' ? 'I126' : 'I137'
                  }
                />
              }
              title={resource.name}
              detail={
                resource.kind === 'credential'
                  ? credentialDescription(resource)
                  : resource.description
              }
              onOpen={() => onOpen(resource)}
            />
          ) : (
            <AppEntry key={resource.id} app={resource} onNavigate={onNavigate} />
          )
        )}
      </ul>
    </section>
  )
}
