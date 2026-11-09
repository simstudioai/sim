import { Avatar } from '@sim/emcn/avatar'
import styles from '@/app/(product)/o/[organizationId]/integrations/_components/people-sentence/people-sentence.module.css'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
import { peopleSummary } from '@/platform/lib/integrations/people-summary'

interface PeopleSentenceProps {
  prefix: string
  people: readonly IntegrationPerson[]
  total?: number
}

export function PeopleSentence({ prefix, people, total }: PeopleSentenceProps) {
  const summary = peopleSummary(people, total)
  if (!summary) return null
  let personIndex = 0
  return (
    <span className={styles.sentence} data-type='T050'>
      <span className={styles.text}>{prefix} </span>
      {summary.parts.map((part, index) => {
        if (part.type === 'literal') return null
        const person = summary.people[personIndex++]
        const prefix = summary.parts[index - 1]?.value.replace(/^,?\s*/, '') ?? ''
        const comma = summary.parts[index + 1]?.value.startsWith(',') ? ',' : ''
        return (
          <span
            key={person?.id ?? `remaining-${index}`}
            className={styles.segment}
            data-person={person ? true : undefined}
          >
            {prefix && <span className={styles.text}>{prefix}</span>}
            {person && (
              <span aria-hidden>
                <Avatar name={person.name} src={person.src} size='inline' />
              </span>
            )}
            <span className={styles.text}>
              {part.value}
              {comma}{' '}
            </span>
          </span>
        )
      })}
    </span>
  )
}
