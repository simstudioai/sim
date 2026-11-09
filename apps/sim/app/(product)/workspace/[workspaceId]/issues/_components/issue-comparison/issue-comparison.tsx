import styles from '@/app/(product)/workspace/[workspaceId]/issues/_components/issue-comparison/issue-comparison.module.css'

interface IssueComparisonProps {
  columns: readonly { label: string; items: readonly string[] }[]
}

/** The current behavior beside the proposed one, item by item. */
export function IssueComparison({ columns }: IssueComparisonProps) {
  return (
    <div className={styles.columns}>
      {columns.map((column) => (
        <div key={column.label} className={styles.column}>
          <h3 data-type='T050'>{column.label}</h3>
          <ul className={styles.items}>
            {column.items.map((item) => (
              <li key={item} data-type='T048'>
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
