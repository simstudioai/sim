import { Badge, Chip } from '@sim/emcn'
import {
  ChevronDown,
  Columns3,
  ListFilter,
  Plus,
  Table,
  TagIcon,
  TypeNumber,
  TypeText,
} from '@sim/emcn/icons'
import { MenuPreviewFrame } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-frame'
import {
  MenuPreviewHeader,
  MenuPreviewToolbar,
} from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'

interface TablesMenuPreviewProps {
  layout?: 'menu' | 'hero'
}

const LEADS = [
  { company: 'Acme Corp', score: 94, status: 'Qualified', contact: 'Alice Johnson' },
  { company: 'Northstar', score: 88, status: 'Qualified', contact: 'Daniel Park' },
  { company: 'Meridian', score: 72, status: 'Review', contact: 'Eva Chen' },
  { company: 'Forma', score: 91, status: 'Qualified', contact: 'Sam Rivera' },
  { company: 'Brightwave', score: 86, status: 'Qualified', contact: 'Morgan Lee' },
] as const

const COLUMNS = [
  { name: 'Company', icon: TypeText },
  { name: 'Score', icon: TypeNumber },
  { name: 'Status', icon: TagIcon },
  { name: 'Contact', icon: TypeText },
] as const

/** A cropped Tables editor with production column types, ruled cells, and neutral select values. */
export function TablesMenuPreview({ layout = 'menu' }: TablesMenuPreviewProps) {
  return (
    <MenuPreviewFrame kind='tables' layout={layout}>
      <div className='w-[620px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text-body)] text-small shadow-xs'>
        <MenuPreviewHeader icon={Table} title='Qualified leads' actions='5 rows' />
        <MenuPreviewToolbar>
          <Chip rightIcon={ChevronDown}>All records</Chip>
          <Chip leftIcon={ListFilter}>Filter</Chip>
          <span className='ml-auto'>
            <Chip leftIcon={Columns3}>Columns</Chip>
          </span>
        </MenuPreviewToolbar>
        <table className='w-full table-fixed border-collapse text-left'>
          <colgroup>
            <col className='w-10' />
            <col className='w-[174px]' />
            <col className='w-[82px]' />
            <col className='w-[138px]' />
            <col className='w-[184px]' />
          </colgroup>
          <thead>
            <tr className='h-[34px] border-[var(--border)] border-b'>
              <th className='border-[var(--border)] border-r text-center font-normal text-[var(--text-muted)]'>
                #
              </th>
              {COLUMNS.map(({ name, icon: Icon }) => (
                <th
                  key={name}
                  className='border-[var(--border)] border-r px-2.5 font-normal last:border-r-0'
                >
                  <span className='flex items-center gap-1.5'>
                    <Icon className='size-[14px] text-[var(--text-icon)]' />
                    {name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LEADS.map((lead, index) => (
              <tr key={lead.company} className='h-[37px] border-[var(--border)] border-b'>
                <td className='border-[var(--border)] border-r text-center text-[var(--text-muted)] tabular-nums'>
                  {index + 1}
                </td>
                <td className='border-[var(--border)] border-r px-2.5'>{lead.company}</td>
                <td className='border-[var(--border)] border-r px-2.5 tabular-nums'>
                  {lead.score}
                </td>
                <td className='border-[var(--border)] border-r px-2.5'>
                  <Badge variant='gray-secondary' size='sm'>
                    {lead.status}
                  </Badge>
                </td>
                <td className='truncate px-2.5 text-[var(--text-secondary)]'>{lead.contact}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className='flex h-9 items-center gap-2 px-3 text-[var(--text-muted)]'>
          <Plus className='size-[14px]' />
          <span>New row</span>
        </div>
      </div>
    </MenuPreviewFrame>
  )
}
