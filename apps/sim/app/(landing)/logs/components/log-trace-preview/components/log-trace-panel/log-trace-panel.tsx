'use client'

import { useState } from 'react'
import { Badge, ChipInput, cn } from '@sim/emcn'
import { ChevronDown, File, Search, Table } from '@sim/emcn/icons'
import { WorkflowTypeIcon } from '@sim/workflow-renderer'
import {
  AgentIcon,
  ApiIcon,
  ResponseIcon,
  ScheduleIcon,
  SlackIcon,
  StartIcon,
  WebhookIcon,
} from '@/components/icons'
import type { PreviewRun } from '@/app/(landing)/logs/components/log-history-preview/types'

const BLOCK_ICONS = {
  start_trigger: StartIcon,
  agent: AgentIcon,
  response: ResponseIcon,
  webhook: WebhookIcon,
  table: Table,
  schedule: ScheduleIcon,
  api: ApiIcon,
  slack: SlackIcon,
  file: File,
} as const

interface LogTracePanelProps {
  run: PreviewRun
}

/** Mirrors TraceView's compact span tree, timing bars, metadata, and stacked JSON sections. */
export function LogTracePanel({ run }: LogTracePanelProps) {
  const [selectedName, setSelectedName] = useState(
    run.spans.find((span) => span.error)?.name ?? run.spans[1].name
  )
  const [query, setQuery] = useState('')
  const selected = run.spans.find((span) => span.name === selectedName) ?? run.spans[0]
  const visible = run.spans.filter((span) => span.name.toLowerCase().includes(query.toLowerCase()))
  const total = run.spans.reduce((sum, span) => sum + span.durationMs, 0)
  const selectedIcon = BLOCK_ICONS[selected.type]

  return (
    <div className='flex min-h-0 flex-1 flex-col text-caption'>
      <div className='flex h-10 shrink-0 items-center gap-2 border-[var(--border)] border-b px-3.5'>
        <Badge variant='gray-secondary' size='sm'>
          {run.status === 'Error' ? 'Error' : 'Success'}
        </Badge>
        <span className='text-[var(--text-secondary)] tabular-nums'>{run.duration}</span>
        <span className='text-[var(--text-tertiary)]'>{run.spans.length} spans</span>
        <ChipInput
          icon={Search}
          placeholder='Filter spans'
          aria-label='Filter sample trace spans'
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className='ml-auto w-[140px]'
        />
      </div>
      <div className='flex min-h-[276px] min-w-[480px] flex-1'>
        <div
          role='group'
          aria-label='Execution spans'
          className='w-[220px] shrink-0 border-[var(--border)] border-r pt-2'
        >
          {visible.map((span) => {
            const index = run.spans.indexOf(span)
            const offset = run.spans
              .slice(0, index)
              .reduce((sum, previous) => sum + previous.durationMs, 0)
            const Icon = BLOCK_ICONS[span.type]
            return (
              <button
                key={span.name}
                type='button'
                aria-pressed={span.name === selected.name}
                onClick={() => setSelectedName(span.name)}
                className={cn(
                  'block w-full cursor-pointer px-3.5 pt-1 pb-[5px] text-left hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--text-secondary)] focus-visible:outline-offset-[-2px]',
                  span.name === selected.name && 'bg-[var(--surface-3)]'
                )}
              >
                <span className='flex items-center gap-1.5'>
                  <WorkflowTypeIcon type={span.type} Icon={Icon} className='size-[14px]' />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-[var(--text-secondary)]',
                      span.error && 'text-[var(--text-error)]'
                    )}
                  >
                    {span.name}
                  </span>
                  <span className='text-[var(--text-tertiary)] tabular-nums'>{span.duration}</span>
                </span>
                <svg
                  aria-hidden='true'
                  viewBox='0 0 100 3'
                  preserveAspectRatio='none'
                  className='mt-[3px] h-[3px] w-full overflow-hidden rounded-full bg-[var(--border)]'
                >
                  <rect
                    x={(100 * offset) / total}
                    width={Math.max(0.5, (100 * span.durationMs) / total)}
                    height='3'
                    rx='1.5'
                    className={
                      span.error ? 'fill-[var(--text-error)]' : 'fill-[var(--text-secondary)]'
                    }
                  />
                </svg>
              </button>
            )
          })}
          {visible.length === 0 && (
            <p className='p-3 text-[var(--text-tertiary)]'>No matching spans</p>
          )}
        </div>
        <div className='min-w-0 flex-1 space-y-3 px-3.5 pt-3 pb-4'>
          <div className='flex items-start gap-2'>
            <WorkflowTypeIcon
              type={selected.type}
              Icon={selectedIcon}
              className='mt-0.5 size-[18px]'
              iconClassName='size-[12px]'
            />
            <div>
              <p className='text-[var(--text-primary)] text-sm'>{selected.name}</p>
              <div className='mt-0.5 flex items-center gap-1.5 text-[var(--text-tertiary)]'>
                <Badge variant='gray-secondary' size='sm'>
                  {selected.error ? 'Error' : 'Success'}
                </Badge>
                <span>· {selected.duration}</span>
              </div>
            </div>
          </div>
          <div className='space-y-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2'>
            <div className='flex justify-between'>
              <span className='text-[var(--text-tertiary)]'>Type</span>
              <span>{selected.type === 'start_trigger' ? 'start' : selected.type}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-[var(--text-tertiary)]'>Duration</span>
              <span>{selected.duration}</span>
            </div>
          </div>
          {[
            { label: 'Input', value: selected.input },
            { label: selected.error ? 'Error' : 'Output', value: selected.output },
          ].map((section) => (
            <details key={`${selected.name}-${section.label}`} open className='group'>
              <summary className='flex cursor-pointer list-none items-center justify-between text-[var(--text-tertiary)] [&::-webkit-details-marker]:hidden'>
                {section.label}
                <ChevronDown className='group-not-open:-rotate-90 size-2' />
              </summary>
              <pre
                className={cn(
                  'mt-1.5 whitespace-pre-wrap rounded-md bg-[var(--surface-4)] p-2 font-mono text-[11px] leading-[1.6] [overflow-wrap:anywhere] dark:bg-[var(--surface-3)]',
                  section.label === 'Error' && 'text-[var(--text-error)]'
                )}
              >
                <code>{section.value}</code>
              </pre>
            </details>
          ))}
        </div>
      </div>
    </div>
  )
}
