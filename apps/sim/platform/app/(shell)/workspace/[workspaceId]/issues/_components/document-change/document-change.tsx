import { Icon } from '@sim/emcn/icon'
import type { DocumentChange as DocumentChangeData } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/issues/_components/document-change/document-change.module.css'

const MARK = { removed: '−', added: '+', context: '' } as const
const SPOKEN = { removed: 'Removed: ', added: 'Added: ', context: '' } as const

interface DocumentChangeProps {
  change: DocumentChangeData
  /** Whether the version transition has been applied or is only proposed. */
  applied: boolean
}

/** A proposed edit to a provider document: where it lands, the lines it changes and the versions. */
export function DocumentChange({ change, applied }: DocumentChangeProps) {
  const changed = change.lines.filter((line) => line.change !== 'context').length
  return (
    <section className={styles.change} aria-label={change.title}>
      <header className={styles.heading}>
        <span className={styles.mark}>
          <Icon providerId={change.provider.id} />
        </span>
        <h2 data-type='T042'>{change.title}</h2>
        <span className={styles.provider} data-type='T050'>
          {change.provider.name}
        </span>
      </header>
      <div className={styles.preview}>
        <div className={styles.context}>
          <h3 data-type='T042'>{change.section}</h3>
          <p data-type='T048'>{change.context}</p>
        </div>
        <ol className={styles.diff} aria-label='Changed lines'>
          {change.lines.map((line) => (
            <li key={line.id} className={styles.line} data-change={line.change}>
              <span className={styles.sign} aria-hidden='true' data-type='T048'>
                {MARK[line.change]}
              </span>
              <span data-type='T048'>
                {line.change !== 'context' && (
                  <span data-visually-hidden>{SPOKEN[line.change]}</span>
                )}
                {line.change === 'removed' ? <del>{line.text}</del> : line.text}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <p className={styles.meta} data-type='T050'>
        <span>
          {applied ? '' : 'Proposed '}
          {change.fromVersion} → {change.toVersion}
        </span>
        <span>
          {changed} changed {changed === 1 ? 'line' : 'lines'}
        </span>
      </p>
    </section>
  )
}
