'use client'

import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { ArrowUpDown, Badge, Library, ListFilter, Search } from '@/components/emcn'
import type { BadgeProps } from '@/components/emcn/components/badge/badge'
import { cn } from '@/lib/core/utils/cn'

interface LogRow {
  id: string
  workflowName: string
  workflowColor: string
  date: string
  status: 'completed' | 'error' | 'running'
  cost: string
  trigger: 'webhook' | 'api' | 'schedule' | 'manual' | 'mcp' | 'chat'
  triggerLabel: string
  duration: string
}

type BadgeVariant = BadgeProps['variant']

const STATUS_VARIANT: Record<LogRow['status'], BadgeVariant> = {
  completed: 'gray',
  error: 'red',
  running: 'amber',
}

const STATUS_LABELS: Record<LogRow['status'], string> = {
  completed: 'Completed',
  error: 'Error',
  running: 'Running',
}

const TRIGGER_VARIANT: Record<LogRow['trigger'], BadgeVariant> = {
  webhook: 'orange',
  api: 'blue',
  schedule: 'green',
  manual: 'gray-secondary',
  mcp: 'cyan',
  chat: 'purple',
}

const MOCK_LOGS: LogRow[] = [
  {
    id: '1',
    workflowName: 'Customer Onboarding',
    workflowColor: '#4f8ef7',
    date: 'Apr 1  10:42 AM',
    status: 'running',
    cost: '-',
    trigger: 'webhook',
    triggerLabel: 'Webhook',
    duration: '-',
  },
  {
    id: '2',
    workflowName: 'Lead Enrichment',
    workflowColor: '#33C482',
    date: 'Apr 1  09:15 AM',
    status: 'error',
    cost: '1 credit',
    trigger: 'api',
    triggerLabel: 'API',
    duration: '2.7s',
  },
  {
    id: '3',
    workflowName: 'Email Campaign',
    workflowColor: '#a855f7',
    date: 'Apr 1  08:30 AM',
    status: 'completed',
    cost: '2 credits',
    trigger: 'schedule',
    triggerLabel: 'Schedule',
    duration: '0.8s',
  },
  {
    id: '4',
    workflowName: 'Data Pipeline',
    workflowColor: '#f97316',
    date: 'Mar 31  10:14 PM',
    status: 'completed',
    cost: '7 credits',
    trigger: 'webhook',
    triggerLabel: 'Webhook',
    duration: '4.1s',
  },
  {
    id: '5',
    workflowName: 'Invoice Processing',
    workflowColor: '#ec4899',
    date: 'Mar 31  08:45 PM',
    status: 'completed',
    cost: '2 credits',
    trigger: 'manual',
    triggerLabel: 'Manual',
    duration: '0.9s',
  },
  {
    id: '6',
    workflowName: 'Support Triage',
    workflowColor: '#0ea5e9',
    date: 'Mar 31  07:22 PM',
    status: 'completed',
    cost: '3 credits',
    trigger: 'api',
    triggerLabel: 'API',
    duration: '1.6s',
  },
  {
    id: '7',
    workflowName: 'Content Moderator',
    workflowColor: '#f59e0b',
    date: 'Mar 31  06:11 PM',
    status: 'error',
    cost: '1 credit',
    trigger: 'schedule',
    triggerLabel: 'Schedule',
    duration: '3.2s',
  },
]

type SortKey = 'workflowName' | 'date' | 'status' | 'cost' | 'trigger' | 'duration'

const COL_HEADERS: { key: SortKey; label: string }[] = [
  { key: 'workflowName', label: 'Workflow' },
  { key: 'date', label: 'Date' },
  { key: 'status', label: 'Status' },
  { key: 'cost', label: 'Cost' },
  { key: 'trigger', label: 'Trigger' },
  { key: 'duration', label: 'Duration' },
]

export function LandingPreviewLogs() {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [activeTab, setActiveTab] = useState<'logs' | 'dashboard'>('logs')

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = useMemo(() => {
    const q = search.toLowerCase()
    const filtered = q
      ? MOCK_LOGS.filter(
          (log) =>
            log.workflowName.toLowerCase().includes(q) ||
            log.triggerLabel.toLowerCase().includes(q) ||
            STATUS_LABELS[log.status].toLowerCase().includes(q)
        )
      : MOCK_LOGS

    if (!sortKey) return filtered
    return [...filtered].sort((a, b) => {
      const av = sortKey === 'cost' ? a.cost.replace(/\D/g, '') : a[sortKey]
      const bv = sortKey === 'cost' ? b.cost.replace(/\D/g, '') : b[sortKey]
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [search, sortKey, sortDir])

  return (
    <div className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'>
      {/* Header */}
      <div className='border-[var(--border)] border-b px-6 py-2.5'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <Library className='h-[14px] w-[14px] text-[var(--text-icon)]' />
            <h1 className='font-medium text-[var(--text-body)] text-sm'>Logs</h1>
          </div>
          <div className='flex items-center gap-1'>
            <div className='flex cursor-default items-center rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
              <Download className='mr-1.5 h-[14px] w-[14px] text-[var(--text-icon)]' />
              Export
            </div>
            <button
              type='button'
              onClick={() => setActiveTab('logs')}
              className='rounded-md px-2 py-1 text-caption transition-colors'
              style={{
                backgroundColor: activeTab === 'logs' ? 'var(--surface-active)' : 'transparent',
                color: activeTab === 'logs' ? 'var(--text-body)' : 'var(--text-secondary)',
              }}
            >
              Logs
            </button>
            <button
              type='button'
              onClick={() => setActiveTab('dashboard')}
              className='rounded-md px-2 py-1 text-caption transition-colors'
              style={{
                backgroundColor:
                  activeTab === 'dashboard' ? 'var(--surface-active)' : 'transparent',
                color: activeTab === 'dashboard' ? 'var(--text-body)' : 'var(--text-secondary)',
              }}
            >
              Dashboard
            </button>
          </div>
        </div>
      </div>

      {/* Options bar */}
      <div className='border-[var(--border)] border-b px-6 py-2.5'>
        <div className='flex items-center justify-between'>
          <div className='flex flex-1 items-center gap-2.5'>
            <Search className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-icon)]' />
            <input
              type='text'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Search logs...'
              className='flex-1 bg-transparent text-[var(--text-body)] text-caption outline-none placeholder:text-[var(--text-subtle)]'
            />
          </div>
          <div className='flex items-center gap-1.5'>
            <div className='flex cursor-default items-center rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
              <ListFilter className='mr-1.5 h-[14px] w-[14px] text-[var(--text-icon)]' />
              Filter
            </div>
            <button
              type='button'
              onClick={() => handleSort(sortKey ?? 'workflowName')}
              className='flex cursor-default items-center rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption transition-colors hover-hover:bg-[var(--surface-3)]'
            >
              <ArrowUpDown className='mr-1.5 h-[14px] w-[14px] text-[var(--text-icon)]' />
              Sort
            </button>
          </div>
        </div>
      </div>

      {/* Table — uses <table> for pixel-perfect column alignment with headers */}
      <div className='min-h-0 flex-1 overflow-hidden'>
        <table className='w-full table-fixed text-sm'>
          <colgroup>
            <col style={{ width: '22%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '18%' }} />
          </colgroup>
          <thead className='shadow-[inset_0_-1px_0_var(--border)]'>
            <tr>
              {COL_HEADERS.map(({ key, label }) => (
                <th
                  key={key}
                  className='h-10 px-6 py-1.5 text-left align-middle font-normal text-caption'
                >
                  <button
                    type='button'
                    onClick={() => handleSort(key)}
                    className={cn(
                      'flex items-center gap-1 transition-colors hover-hover:text-[var(--text-secondary)]',
                      sortKey === key ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'
                    )}
                  >
                    {label}
                    {sortKey === key && <ArrowUpDown className='h-[10px] w-[10px] opacity-60' />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((log) => (
              <tr
                key={log.id}
                className='h-[44px] cursor-default transition-colors hover-hover:bg-[var(--surface-3)]'
              >
                <td className='px-6 align-middle'>
                  <div className='flex items-center gap-2'>
                    <div
                      className='h-[10px] w-[10px] flex-shrink-0 rounded-[3px] border-[1.5px]'
                      style={{
                        backgroundColor: log.workflowColor,
                        borderColor: `${log.workflowColor}60`,
                        backgroundClip: 'padding-box',
                      }}
                    />
                    <span className='min-w-0 truncate font-medium text-[var(--text-primary)] text-caption'>
                      {log.workflowName}
                    </span>
                  </div>
                </td>
                <td className='px-6 align-middle text-[var(--text-secondary)] text-caption'>
                  {log.date}
                </td>
                <td className='px-6 align-middle'>
                  <Badge variant={STATUS_VARIANT[log.status]} size='sm' dot>
                    {STATUS_LABELS[log.status]}
                  </Badge>
                </td>
                <td className='px-6 align-middle text-[var(--text-secondary)] text-caption'>
                  {log.cost}
                </td>
                <td className='px-6 align-middle'>
                  <Badge variant={TRIGGER_VARIANT[log.trigger]} size='sm'>
                    {log.triggerLabel}
                  </Badge>
                </td>
                <td className='px-6 align-middle text-[var(--text-secondary)] text-caption'>
                  {log.duration}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
