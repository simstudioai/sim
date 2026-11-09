import styles from '@/app/(product)/workspace/[workspaceId]/_components/file-preview/data-table.module.css'

interface DataTableProps {
  headers: readonly string[]
  rows: readonly (readonly string[])[]
}

/**
 * A spreadsheet or CSV page as a table sized to its data: columns take their values' width within
 * bounds and the caller's frame scrolls whatever overflows.
 */
export function DataTable({ headers, rows }: DataTableProps) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          {headers.map((header, index) => (
            <th key={index} data-type='T059'>
              {String(header ?? '')}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {headers.map((_, columnIndex) => (
              <td key={columnIndex} data-type='T060'>
                {String(row[columnIndex] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
