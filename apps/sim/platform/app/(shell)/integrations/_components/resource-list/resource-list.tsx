import { ActivityRow } from '@sim/emcn/activity-row'
import { Icon } from '@sim/emcn/icon'
import { IntegrationMark } from '@/platform/app/(shell)/integrations/_components/integration-mark/integration-mark'
import { IntegrationUsageText } from '@/platform/app/(shell)/integrations/_components/integration-usage/integration-usage'
import styles from '@/platform/app/(shell)/integrations/_components/resource-list/resource-list.module.css'
import type { AppSummary, IntegrationResource } from '@/platform/lib/integrations/center-model'
import { credentialDescription } from '@/platform/lib/integrations/credential-display'
import { peopleSummary } from '@/platform/lib/integrations/people-summary'

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
  const usage =
    !app.scope && !app.connected && (app.people?.length ?? 0) >= 2
      ? peopleSummary(app.people ?? [], app.peopleTotal)
      : undefined
  const detail =
    !app.scope && app.connected && app.credentialCount !== undefined
      ? `${app.credentialCount} connected ${app.credentialCount === 1 ? 'credential' : 'credentials'}`
      : usage
        ? `Used by ${usage.label}`
        : app.description
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
        usage ? (
          <IntegrationUsageText people={app.people ?? []} total={app.peopleTotal} />
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
  resourceHref: (resource: IntegrationResource) => string
}

export function ResourceGroup({
  title,
  resources,
  links = [],
  order,
  onNavigate,
  onOpen,
  resourceHref,
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
            resource.kind === 'credential' ? (
              <ActivityRow
                key={resource.id}
                leading={
                  resource.appId ? (
                    <IntegrationMark providerId={resource.appId} />
                  ) : (
                    <Icon name='I137' />
                  )
                }
                title={resource.name}
                detail={credentialDescription(resource)}
                onOpen={() => onOpen(resource)}
              />
            ) : (
              <ActivityRow
                key={resource.id}
                href={resourceHref(resource)}
                onNavigate={(event) => {
                  event.preventDefault()
                  onOpen(resource)
                }}
                leading={<Icon name={resource.kind === 'skill' ? 'I044' : 'I126'} />}
                title={resource.name}
                detail={resource.description}
              />
            )
          ) : (
            <AppEntry key={resource.id} app={resource} onNavigate={onNavigate} />
          )
        )}
      </ul>
    </section>
  )
}

interface SkillGroupProps {
  title: string
  skills: readonly { id: string; name: string; description: string; href: string }[]
  onOpen: (id: string) => void
}

/** A workspace's live skills, with the same group and row rhythm as the library's resources. */
export function SkillGroup({ title, skills, onOpen }: SkillGroupProps) {
  if (!skills.length) return null
  return (
    <section className={styles.group} aria-label={title}>
      <h2 data-type='T059'>{title}</h2>
      <ul className={styles.rows}>
        {skills.map((skill) => (
          <ActivityRow
            key={skill.id}
            href={skill.href}
            onNavigate={(event) => {
              event.preventDefault()
              onOpen(skill.id)
            }}
            leading={<Icon name='I044' />}
            title={skill.name}
            detail={skill.description}
          />
        ))}
      </ul>
    </section>
  )
}
