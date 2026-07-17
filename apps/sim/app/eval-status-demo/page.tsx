'use client'

import { useCallback, useRef, useState } from 'react'
import {
  EvalStatusIndicator,
  type EvalStatusIndicatorStatus,
} from '@/components/ui/eval-status-indicator'

/**
 * DEMO ONLY — showcase page for the EvalStatusIndicator handoff.
 * Not linked from anywhere; delete this route before merging the component.
 */

const SIZES = [20, 32, 48] as const
const STATUSES: readonly EvalStatusIndicatorStatus[] = [
  'progress',
  'partial',
  'complete',
  'failed',
] as const

interface PanelProps {
  theme: 'light' | 'dark'
}

function Panel({ theme }: PanelProps) {
  const [percent, setPercent] = useState(80)
  const [runStatus, setRunStatus] = useState<EvalStatusIndicatorStatus>('progress')
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const simulate = useCallback((outcome: EvalStatusIndicatorStatus) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setRunStatus('progress')
    timeoutRef.current = setTimeout(() => setRunStatus(outcome), 1800)
  }, [])

  const dark = theme === 'dark'
  const text = dark ? 'text-[#d6d6d6]' : 'text-[#2c2c2c]'
  const mutedText = dark ? 'text-[#8a8a8a]' : 'text-[#8a8a8a]'
  const buttonChrome = dark
    ? 'border-[#3a3a3a] bg-[#242424] text-[#d6d6d6] hover:bg-[#2e2e2e]'
    : 'border-[#d9d9d9] bg-white text-[#2c2c2c] hover:bg-[#f2f2f2]'

  return (
    <div
      className={`${theme} flex flex-1 flex-col gap-10 rounded-xl p-10 ${
        dark ? 'bg-[#141414]' : 'bg-[#f4f4f4]'
      }`}
    >
      <h2 className={`font-medium text-[15px] ${text}`}>
        {dark ? 'Dark surface' : 'Light surface'}
      </h2>

      <section className='flex flex-col gap-4'>
        <p className={`text-[12px] uppercase tracking-wide ${mutedText}`}>States × sizes</p>
        <div className='flex flex-col gap-5'>
          {SIZES.map((size) => (
            <div key={size} className='flex items-center gap-8'>
              {STATUSES.map((status) => (
                <div key={status} className='flex w-[90px] flex-col items-center gap-2'>
                  <EvalStatusIndicator status={status} percent={percent} size={size} />
                  <span className={`text-[11px] ${mutedText}`}>{status}</span>
                </div>
              ))}
              <span className={`text-[11px] ${mutedText}`}>{size}px</span>
            </div>
          ))}
        </div>
      </section>

      <section className='flex flex-col gap-3'>
        <p className={`text-[12px] uppercase tracking-wide ${mutedText}`}>
          Partial percent — {percent}%
        </p>
        <input
          type='range'
          min={0}
          max={100}
          value={percent}
          onChange={(e) => setPercent(Number(e.target.value))}
          className='w-[280px]'
        />
      </section>

      <section className='flex flex-col gap-4'>
        <p className={`text-[12px] uppercase tracking-wide ${mutedText}`}>
          Transition — progress melts into the disc, then dips and pops
        </p>
        <div className='flex items-center gap-6'>
          <EvalStatusIndicator status={runStatus} size={48} />
          <button
            type='button'
            onClick={() => simulate('complete')}
            className={`rounded-md border px-3 py-1.5 text-[13px] ${buttonChrome}`}
          >
            Run → complete
          </button>
          <button
            type='button'
            onClick={() => simulate('failed')}
            className={`rounded-md border px-3 py-1.5 text-[13px] ${buttonChrome}`}
          >
            Run → fail
          </button>
          <button
            type='button'
            onClick={() => simulate('partial')}
            className={`rounded-md border px-3 py-1.5 text-[13px] ${buttonChrome}`}
          >
            Run → partial
          </button>
        </div>
      </section>

      <section className='flex flex-col gap-4'>
        <p className={`text-[12px] uppercase tracking-wide ${mutedText}`}>
          Row context (eval case grid)
        </p>
        <div className='flex flex-col gap-3'>
          {[
            ['complete', 'complete', 'complete', 'progress', 'partial', 'failed', 'failed'],
            ['complete', 'complete', 'failed', 'progress', 'progress', 'partial', 'complete'],
            ['complete', 'partial', 'complete', 'failed', 'progress', 'complete', 'partial'],
          ].map((row, i) => (
            <div key={i} className='flex items-center gap-3'>
              {row.map((status, j) => (
                <EvalStatusIndicator
                  key={j}
                  status={status as EvalStatusIndicatorStatus}
                  percent={40 + ((i * 17 + j * 23) % 55)}
                  size={24}
                />
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default function EvalStatusDemoPage() {
  return (
    <main className='min-h-screen bg-[#e9e9e9] p-8'>
      <div className='mx-auto flex max-w-[1200px] flex-col gap-6'>
        <div>
          <h1 className='font-medium text-[#2c2c2c] text-[18px]'>EvalStatusIndicator — demo</h1>
          <p className='mt-1 text-[#767676] text-[13px]'>
            Gooey signal/status indicators for Evals, built on the ThinkingLoader material.
            Demo-only route — delete before merge.
          </p>
        </div>
        <div className='flex flex-col gap-6 lg:flex-row'>
          <Panel theme='light' />
          <Panel theme='dark' />
        </div>
      </div>
    </main>
  )
}
