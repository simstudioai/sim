import { ArrowUpDown, Badge, Library, ListFilter, Workflow } from '@/components/emcn'
import type { BadgeProps } from '@/components/emcn/components/badge/badge'

/**
 * LogsTablePreview - a static recreation of the Sim Logs page, used as the
 * graphic inside the Logs card's {@link PlatformCorner} white block. It shows a
 * fragment of the real Logs view: the header (`Logs` title + Filter/Sort), then
 * the run table - workflow name, status, trigger, cost, and duration - with the
 * platform's `Badge` chrome (dotted status pills, trigger pills).
 *
 * Purely presentational (no search/sort state) - it's a corner of the product
 * framed as a screenshot, so the panel's right columns and lower rows dissolve
 * through the {@link PlatformCorner} corner fade.
 */
type BadgeVariant = BadgeProps['variant']

interface LogRow {
  workflow: string
  date: string
  statusLabel: string
  statusVariant: BadgeVariant
  trigger: string
  cost: string
  duration: string
}

const ROWS: LogRow[] = [
  {
    workflow: 'Customer Onboarding',
    date: 'Apr 1  10:42 AM',
    statusLabel: 'Running',
    statusVariant: 'gray',
    trigger: 'Webhook',
    cost: '–',
    duration: '–',
  },
  {
    workflow: 'Lead Enrichment',
    date: 'Apr 1  09:15 AM',
    statusLabel: 'Completed',
    statusVariant: 'gray-secondary',
    trigger: 'API',
    cost: '2 credits',
    duration: '1.2s',
  },
  {
    workflow: 'Email Campaign',
    date: 'Apr 1  08:30 AM',
    statusLabel: 'Completed',
    statusVariant: 'gray-secondary',
    trigger: 'Schedule',
    cost: '2 credits',
    duration: '0.8s',
  },
  {
    workflow: 'Data Pipeline',
    date: 'Mar 31  10:14 PM',
    statusLabel: 'Completed',
    statusVariant: 'gray-secondary',
    trigger: 'Webhook',
    cost: '7 credits',
    duration: '4.1s',
  },
  {
    workflow: 'Support Triage',
    date: 'Mar 31  07:22 PM',
    statusLabel: 'Error',
    statusVariant: 'gray',
    trigger: 'API',
    cost: '1 credit',
    duration: '2.7s',
  },
  {
    workflow: 'Invoice Processing',
    date: 'Mar 31  06:45 PM',
    statusLabel: 'Completed',
    statusVariant: 'gray-secondary',
    trigger: 'Manual',
    cost: '2 credits',
    duration: '0.9s',
  },
  {
    workflow: 'Content Moderator',
    date: 'Mar 31  05:11 PM',
    statusLabel: 'Completed',
    statusVariant: 'gray-secondary',
    trigger: 'Schedule',
    cost: '3 credits',
    duration: '1.6s',
  },
]

const COL_HEADERS = ['Workflow', 'Status', 'Trigger', 'Cost', 'Duration'] as const

export function LogsTablePreview() {
  return (
    <div className='flex h-full flex-col'>
      <div className='flex h-[44px] flex-shrink-0 items-center justify-between border-[var(--border)] border-b px-5'>
        <div className='flex items-center gap-2'>
          <Library className='size-[14px] text-[var(--text-icon)]' />
          <span className='font-medium text-[var(--text-body)] text-sm'>Logs</span>
        </div>
        <div className='flex items-center gap-1'>
          <span className='flex items-center gap-1.5 rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
            <ListFilter className='size-[14px] text-[var(--text-icon)]' />
            Filter
          </span>
          <span className='flex items-center gap-1.5 rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
            <ArrowUpDown className='size-[14px] text-[var(--text-icon)]' />
            Sort
          </span>
        </div>
      </div>

      <table className='w-full table-fixed'>
        <colgroup>
          <col style={{ width: '30%' }} />
          <col style={{ width: '17%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '22%' }} />
        </colgroup>
        <thead className='shadow-[inset_0_-1px_0_var(--border)]'>
          <tr>
            {COL_HEADERS.map((label) => (
              <th
                key={label}
                className='h-9 px-5 text-left align-middle font-normal text-[var(--text-muted)] text-caption'
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.workflow} className='h-[40px] border-[var(--border)] border-b'>
              <td className='px-5 align-middle'>
                <div className='flex items-center gap-2'>
                  <Workflow className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
                  <span className='truncate font-medium text-[var(--text-primary)] text-caption'>
                    {row.workflow}
                  </span>
                </div>
              </td>
              <td className='px-5 align-middle'>
                <Badge variant={row.statusVariant} size='sm' dot>
                  {row.statusLabel}
                </Badge>
              </td>
              <td className='px-5 align-middle'>
                <Badge variant='gray-secondary' size='sm'>
                  {row.trigger}
                </Badge>
              </td>
              <td className='whitespace-nowrap px-5 align-middle text-[var(--text-secondary)] text-caption'>
                {row.cost}
              </td>
              <td className='whitespace-nowrap px-5 align-middle text-[var(--text-secondary)] text-caption'>
                {row.duration}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
