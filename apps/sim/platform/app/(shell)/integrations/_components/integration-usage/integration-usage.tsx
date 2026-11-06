import styles from '@/platform/app/(shell)/integrations/_components/integration-usage/integration-usage.module.css'
import { Avatar } from '@/platform/design-system/components'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'

interface IntegrationUsageProps {
  people: readonly IntegrationPerson[]
  total?: number
}

export function IntegrationUsage({ people, total = people.length }: IntegrationUsageProps) {
  if (!people.length && !total) return null
  const person = people[0]
  const remaining = Math.max(0, total - (person ? 1 : 0))
  return (
    <span className={styles.usage} data-type='T050'>
      <span>Used by</span>
      {person && (
        <span className={styles.person}>
          <Avatar name={person.name} src={person.src} size='inline' />
          <span>{person.name}</span>
        </span>
      )}
      {remaining > 0 && (
        <span>
          {person ? 'and ' : ''}
          {remaining.toLocaleString('en-US')}{' '}
          {person ? (remaining === 1 ? 'other' : 'others') : remaining === 1 ? 'person' : 'people'}
        </span>
      )}
    </span>
  )
}
