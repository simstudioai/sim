import { CopyButton } from '@sim/emcn/button/copy-button'
import { OverflowText } from '@sim/emcn/overflow-text'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/execution-details/execution-details.module.css'

export interface Fact {
  id: string
  label: string
  value: string
  /** Opens the value's record in a new tab. */
  href?: string
  /** Offers to copy the value, as an id is copied. */
  copyable?: boolean
}

interface FactsProps {
  label: string
  facts: readonly Fact[]
}

/**
 * A caption over a one-line value, in columns shared from row to row, as the workspace Logs page
 * reads a run's facts. A value wider than its column fades and shows in full on hover.
 */
export function Facts({ label, facts }: FactsProps) {
  return (
    <section aria-label={label}>
      <dl className={styles.facts}>
        {facts.map((fact) => (
          <div key={fact.id} className={styles.fact}>
            <dt data-type='T050'>{fact.label}</dt>
            <dd data-type='T060'>
              {fact.href ? (
                <a
                  className={styles.factLink}
                  href={fact.href}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  <OverflowText text={fact.value}>{fact.value}</OverflowText>
                </a>
              ) : (
                <OverflowText text={fact.value}>{fact.value}</OverflowText>
              )}
              {fact.copyable && (
                <span className={styles.factAction}>
                  <CopyButton
                    label={`Copy ${fact.label.toLowerCase()}`}
                    text={fact.value}
                    size='compact'
                  />
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
