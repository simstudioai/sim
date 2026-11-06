import styles from '@/platform/app/(shell)/integrations/_components/integration-usage/integration-usage.module.css'
import { Avatar } from '@/platform/design-system/components'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
import { integrationUsageSummary } from '@/platform/lib/integrations/usage'

interface IntegrationUsageProps {
  people: readonly IntegrationPerson[]
  total?: number
}

export function IntegrationUsage({ people, total = people.length }: IntegrationUsageProps) {
  if (!people.length && !total) return null
  return (
    <span className={styles.usage} data-type='T050'>
      <IntegrationUsageText people={people} total={total} />
    </span>
  )
}

export function IntegrationUsageText({ people, total }: IntegrationUsageProps) {
  const usage = integrationUsageSummary(people, total)
  if (!usage) return null
  let personIndex = 0
  return (
    <span>
      Used by{' '}
      {usage.parts.map((part, index) => {
        if (part.type === 'literal') return part.value
        const person = usage.people[personIndex++]
        return person ? (
          <span key={person.id} className={styles.person}>
            <span aria-hidden>
              <Avatar name={person.name} src={person.src} size='inline' />
            </span>
            <span>{person.name}</span>
          </span>
        ) : (
          <span key={`remaining-${index}`} className={styles.remaining}>
            {part.value}
          </span>
        )
      })}
    </span>
  )
}
