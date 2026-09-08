import { useState } from 'react'
import { Badge, ChipModalTabs } from '@sim/emcn'
import type { PreviewRun } from '@/app/(landing)/logs/components/log-history-preview/types'
import { LogTracePanel } from '@/app/(landing)/logs/components/log-trace-preview/components/log-trace-panel'

interface LogPreviewDetailsProps {
  id: string
  run: PreviewRun
}

/** Uses LogDetailsContent's Overview fields and native Overview / Trace switch. */
export function LogPreviewDetails({ id, run }: LogPreviewDetailsProps) {
  const [tab, setTab] = useState('overview')

  return (
    <div
      id={id}
      role='region'
      aria-label={`${run.name} execution details`}
      className='min-h-0 flex-1 overflow-auto overscroll-contain'
    >
      <div className='p-3.5'>
        <ChipModalTabs
          tabs={[
            { value: 'overview', label: 'Overview' },
            { value: 'trace', label: 'Trace' },
          ]}
          value={tab}
          onChange={setTab}
          aria-label='Sample run details view'
        />
      </div>
      {tab === 'trace' ? (
        <LogTracePanel run={run} />
      ) : (
        <div className='space-y-3 px-3.5 pb-4 text-caption'>
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <p className='text-[var(--text-tertiary)]'>Timestamp</p>
              <p className='mt-0.5 text-sm'>Sep 7 {run.time}</p>
            </div>
            <div>
              <p className='text-[var(--text-tertiary)]'>Workflow</p>
              <p className='mt-0.5 text-sm'>{run.name}</p>
            </div>
          </div>
          <div className='divide-y divide-[var(--border)] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-2)]'>
            <div className='flex h-10 items-center justify-between px-3'>
              <span className='text-[var(--text-tertiary)]'>Level</span>
              <Badge variant='gray' dot size='sm'>
                {run.status === 'Error' ? 'Error' : 'Info'}
              </Badge>
            </div>
            {[
              { label: 'Trigger', value: run.trigger },
              { label: 'Duration', value: run.duration },
            ].map((item) => (
              <div key={item.label} className='flex h-10 items-center justify-between px-3'>
                <span className='text-[var(--text-tertiary)]'>{item.label}</span>
                <span className='tabular-nums'>{item.value}</span>
              </div>
            ))}
          </div>
          <p className='text-[var(--text-tertiary)]'>Workflow Output</p>
          <pre className='whitespace-pre-wrap rounded-md bg-[var(--surface-4)] p-3 font-mono text-[11px] leading-relaxed [overflow-wrap:anywhere] dark:bg-[var(--surface-3)]'>
            <code>{run.spans[run.spans.length - 1].output}</code>
          </pre>
        </div>
      )}
    </div>
  )
}
