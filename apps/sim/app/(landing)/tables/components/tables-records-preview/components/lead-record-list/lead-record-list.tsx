import { Badge, cn } from '@sim/emcn'
import { TagIcon, TypeNumber, TypeText } from '@sim/emcn/icons'
import type { LeadRecord } from '@/app/(landing)/tables/components/tables-records-preview/data'

interface LeadRecordListProps {
  rows: readonly LeadRecord[]
  selectedId: string | null
  onSelect: (id: string, opener: HTMLButtonElement) => void
  showContact: boolean
}

const CELL = 'border-[var(--border)] border-r px-2.5 last:border-r-0'
const COLUMNS = [
  { name: 'Company', icon: TypeText },
  { name: 'Score', icon: TypeNumber },
  { name: 'Status', icon: TagIcon },
  { name: 'Contact', icon: TypeText },
] as const

/** Matches TablesMenuPreview's column icons, 34px header, 37px rows, and neutral select chips. */
export function LeadRecordList({ rows, selectedId, onSelect, showContact }: LeadRecordListProps) {
  const columns = showContact ? COLUMNS : COLUMNS.slice(0, 3)
  return (
    <div className='h-[354px] overflow-auto'>
      <table className='w-full min-w-[600px] table-fixed border-collapse text-left text-small'>
        <colgroup>
          <col className='w-10' />
          <col className='w-[174px]' />
          <col className='w-[82px]' />
          <col className='w-[138px]' />
          {showContact && <col className='w-[184px]' />}
        </colgroup>
        <thead>
          <tr className='h-[34px] border-[var(--border)] border-b'>
            <th className={cn(CELL, 'text-center font-normal text-[var(--text-secondary)]')}>#</th>
            {columns.map(({ name, icon: Icon }) => (
              <th key={name} className={cn(CELL, 'font-normal')}>
                <span className='flex items-center gap-1.5'>
                  <Icon aria-hidden='true' className='size-[14px] text-[var(--text-icon)]' />
                  {name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.id}
              className={cn(
                'h-[37px] border-[var(--border)] border-b hover:bg-[var(--surface-hover)]',
                selectedId === row.id && 'bg-[var(--surface-active)]'
              )}
            >
              <td className={cn(CELL, 'text-center text-[var(--text-secondary)] tabular-nums')}>
                {index + 1}
              </td>
              <td className={CELL}>
                <button
                  type='button'
                  aria-label={`Edit ${row.company} row`}
                  aria-haspopup='dialog'
                  onClick={(event) => onSelect(row.id, event.currentTarget)}
                  className='h-[37px] w-full rounded-sm text-left focus-visible:outline-2 focus-visible:outline-[var(--text-primary)]'
                >
                  {row.company}
                </button>
              </td>
              <td className={cn(CELL, 'tabular-nums')}>{row.score}</td>
              <td className={CELL}>
                <Badge variant='gray-secondary' size='sm'>
                  {row.status}
                </Badge>
              </td>
              {showContact && (
                <td className={cn(CELL, 'truncate text-[var(--text-secondary)]')}>{row.contact}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
