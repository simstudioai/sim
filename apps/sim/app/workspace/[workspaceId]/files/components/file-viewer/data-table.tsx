import { memo } from 'react'

interface DataTableProps {
  headers: string[]
  rows: string[][]
}

export const DataTable = memo(function DataTable({ headers, rows }: DataTableProps) {
  return (
    <div className='overflow-x-auto rounded-md border border-[var(--border)]'>
      <table className='w-full border-collapse text-[13px]'>
        <thead className='bg-[var(--surface-2)]'>
          <tr>
            {headers.map((header, i) => (
              <th
                key={i}
                className='whitespace-nowrap px-3 py-2 text-left font-semibold text-[12px] text-[var(--text-primary)]'
              >
                {String(header ?? '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className='border-[var(--border)] border-t'>
              {headers.map((_, ci) => (
                <td key={ci} className='whitespace-nowrap px-3 py-2 text-[var(--text-secondary)]'>
                  {String(row[ci] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})
