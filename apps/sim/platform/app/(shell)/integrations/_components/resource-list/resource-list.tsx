import { IntegrationMark } from '@/platform/app/(shell)/integrations/_components/integration-mark/integration-mark'
import { IntegrationUsage } from '@/platform/app/(shell)/integrations/_components/integration-usage/integration-usage'
import styles from '@/platform/app/(shell)/integrations/_components/resource-list/resource-list.module.css'
import { ActionMenu, ActivityRow, Icon } from '@/platform/design-system/components'
import type { AppSummary, IntegrationResource } from '@/platform/lib/integrations/center-model'

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
  return (
    <ActivityRow
      href={app.href}
      onNavigate={(event) => {
        event.preventDefault()
        onNavigate(app.href)
      }}
      leading={<IntegrationMark providerId={app.providerId ?? app.id} icon={app.icon} />}
      title={app.name}
      detail={app.description}
      metadata={
        app.people?.length || app.peopleTotal ? (
          <IntegrationUsage
            people={app.people ?? []}
            total={app.peopleTotal}
            label={app.scope ? 'People with access' : undefined}
          />
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
  onDelete: (resource: IntegrationResource) => void
}

export function ResourceGroup({
  title,
  resources,
  links = [],
  order,
  onNavigate,
  onOpen,
  onDelete,
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
              detail={resource.description}
              showChevron={false}
              onOpen={() => onOpen(resource)}
              metadata={
                resource.scope === 'shared' ? (
                  <IntegrationUsage people={resource.people} label='Shared with' />
                ) : undefined
              }
              trailing={
                <>
                  {resource.canEdit && (
                    <ActionMenu
                      label={`Manage ${resource.name}`}
                      icon='I108'
                      actions={[
                        { id: 'edit', label: 'Edit', onSelect: () => onOpen(resource) },
                        { id: 'share', label: 'Manage access', onSelect: () => onOpen(resource) },
                        {
                          id: 'delete',
                          label: 'Delete',
                          destructive: true,
                          separatorBefore: true,
                          onSelect: () => onDelete(resource),
                        },
                      ]}
                    />
                  )}
                </>
              }
            />
          ) : (
            <AppEntry key={resource.id} app={resource} onNavigate={onNavigate} />
          )
        )}
      </ul>
    </section>
  )
}
