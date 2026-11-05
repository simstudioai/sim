import type { SearchSourceRow } from '@/platform/app/(shell)/_components/search/model'
import styles from '@/platform/app/(shell)/_components/search/search.module.css'
import { ActionMenu, OverflowText } from '@/platform/design-system/components'
import { ActivityBody } from '@/platform/design-system/components/activity-row/activity-body'

interface SourceRowProps {
  row: SearchSourceRow
  onOpen: (row: SearchSourceRow) => void
  onCopyLink: (row: SearchSourceRow) => void
  onSummarize?: (row: SearchSourceRow) => void
}

export function SourceRow({ row, onOpen, onCopyLink, onSummarize }: SourceRowProps) {
  return (
    <article className={styles.row}>
      <ActivityBody>
        <a
          className={styles.rowTitle}
          data-type='T048'
          data-source-link=''
          href={row.url}
          target='_blank'
          rel='noopener noreferrer'
          onClick={() => onOpen(row)}
        >
          <OverflowText text={row.title}>{row.title}</OverflowText>
        </a>
        {row.meta && (
          <span className={styles.quiet} data-type='T052'>
            {row.meta}
          </span>
        )}
        {row.snippet && (
          <span className={styles.snippet} data-type='T052'>
            {row.snippet}
          </span>
        )}
      </ActivityBody>
      <ActionMenu
        label={`Actions for ${row.title}`}
        icon='I108'
        actions={[
          ...(onSummarize
            ? [{ id: 'summarize', label: 'Summarize', onSelect: () => onSummarize(row) }]
            : []),
          { id: 'copy', label: 'Copy link', onSelect: () => onCopyLink(row) },
        ]}
      />
    </article>
  )
}
