import styles from '@/app/(product)/o/[organizationId]/integrations/_components/integration-usage/integration-usage.module.css'
import { PeopleSentence } from '@/app/(product)/o/[organizationId]/integrations/_components/people-sentence/people-sentence'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'

interface IntegrationUsageProps {
  people: readonly IntegrationPerson[]
  total?: number
}

export function IntegrationUsage({ people, total = people.length }: IntegrationUsageProps) {
  if (people.length < 2) return null
  return (
    <span className={styles.usage}>
      <IntegrationUsageText people={people} total={total} />
    </span>
  )
}

export function IntegrationUsageText({ people, total }: IntegrationUsageProps) {
  if (people.length < 2) return null
  return <PeopleSentence prefix='Used by' people={people} total={total} />
}
