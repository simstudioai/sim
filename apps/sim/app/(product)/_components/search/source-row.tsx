import { ActivityBody } from '@sim/emcn/activity-row/activity-body'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { OverflowText } from '@sim/emcn/overflow-text'
import type { SearchSourceRow } from '@/app/(product)/_components/search/model'
import styles from '@/app/(product)/_components/search/search.module.css'

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
