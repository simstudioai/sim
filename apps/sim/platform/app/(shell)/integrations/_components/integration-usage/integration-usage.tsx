import styles from '@/platform/app/(shell)/integrations/_components/integration-usage/integration-usage.module.css'
import { Avatar, AvatarGroup } from '@/platform/design-system/components'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'

interface IntegrationUsageProps {
  people: readonly IntegrationPerson[]
  total?: number
  expanded?: boolean
  label?: string
}

export function IntegrationUsage({
  people,
  total = people.length,
  expanded,
  label = 'Used by',
}: IntegrationUsageProps) {
  if (!people.length && !total) return null
  if (!expanded) return <AvatarGroup people={people} total={total} label={label} />
  const visible = people.slice(0, 2)
  const remaining = Math.max(0, total - visible.length)
  return (
    <span className={styles.usage} data-type='T050'>
      <span>{label}</span>
      {visible.map((person, index) => (
        <span key={person.id} className={styles.person}>
          {index > 0 && !remaining && <span>and</span>}
          <Avatar name={person.name} src={person.src} size='inline' />
          <span>
            {person.name}
            {index < visible.length - 1 && remaining > 0 ? ',' : ''}
          </span>
        </span>
      ))}
      {remaining > 0 && (
        <span>
          {visible.length ? 'and ' : ''}
          {remaining.toLocaleString('en-US')} {remaining === 1 ? 'other' : 'others'}
        </span>
      )}
    </span>
  )
}
