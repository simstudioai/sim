'use client'

import { useEffect, useState } from 'react'
import { Avatar, cn } from '@sim/emcn'
import { CircleCheck, Mic, Plus } from '@sim/emcn/icons'
import Link from 'next/link'
import { ShimmerText } from '@/components/ui/shimmer-text'
import { LinkedTickets } from '@/app/playground/org/components/linked-tickets'
import type { RunningWork } from '@/app/playground/org/lib/changelog-data'
import { protoRoutes } from '@/app/playground/org/lib/routes'

const NARRATION_INTERVAL_S = 7

function formatElapsed(total: number): string {
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`
}

interface AgentRunProps {
  work: RunningWork
  workspaceId: string
}

/**
 * A background run seen from inside its chat: elapsed time, what the agent is saying now,
 * a Thinking shimmer, and a composer to steer, auto-approve, or stop it.
 */
export function AgentRun({ work, workspaceId }: AgentRunProps) {
  const [seconds, setSeconds] = useState(0)
  const [autoApprove, setAutoApprove] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [draft, setDraft] = useState('')
  const [steer, setSteer] = useState<string | null>(null)

  useEffect(() => {
    if (stopped) return
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(timer)
  }, [stopped])

  const elapsed = work.startedMinutesAgo * 60 + seconds
  const shown = Math.min(work.narration.length, 1 + Math.floor(seconds / NARRATION_INTERVAL_S))
  const owner = work.chat.owner.split(' ')[0]

  return (
    <div className='flex flex-col gap-4'>
      <span className='text-[var(--text-muted)] text-small'>
        {stopped
          ? `Stopped after ${formatElapsed(elapsed)} · ${work.task}`
          : `Working for ${formatElapsed(elapsed)} · ${work.task}`}
      </span>
      <div className='flex flex-col gap-3'>
        {work.narration.slice(0, shown).map((line, index) => (
          <p
            key={line}
            className={cn(
              'text-md leading-relaxed',
              index === shown - 1 ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
            )}
          >
            {line}
          </p>
        ))}
        {steer && (
          <p className='self-end rounded-xl bg-[var(--surface-5)] px-3 py-1.5 text-[var(--text-body)] text-small'>
            {steer}
          </p>
        )}
        {!stopped && <ShimmerText className='text-md'>Thinking</ShimmerText>}
      </div>

      <div className='flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 pt-2.5 pb-2'>
        <input
          value={draft}
          disabled={stopped}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) {
              setSteer(draft.trim())
              setDraft('')
            }
          }}
          placeholder={stopped ? 'Stopped' : `Steer ${work.agent}…`}
          className='w-full bg-transparent text-[var(--text-body)] text-md outline-none placeholder:text-[var(--text-muted)]'
        />
        <div className='flex items-center gap-1'>
          <button
            type='button'
            aria-label='Attach'
            className='flex size-[26px] items-center justify-center rounded-lg hover-hover:bg-[var(--surface-hover)]'
          >
            <Plus className='size-[14px] text-[var(--text-icon)]' />
          </button>
          <button
            type='button'
            aria-pressed={autoApprove}
            onClick={() => setAutoApprove((prev) => !prev)}
            className={cn(
              'flex h-[26px] items-center gap-1.5 rounded-lg px-2 text-small hover-hover:bg-[var(--surface-hover)]',
              autoApprove ? 'text-[var(--text-body)]' : 'text-[var(--text-muted)]'
            )}
          >
            <CircleCheck
              className={cn(
                'size-[13px]',
                autoApprove ? 'text-[var(--success)]' : 'text-[var(--text-icon)]'
              )}
            />
            Approve for me
          </button>
          <span className='ml-auto flex items-center gap-2 text-[var(--text-muted)] text-small'>
            <span className='inline-flex items-center gap-0.5'>
              <Link
                href={protoRoutes.issue(workspaceId, work.issue)}
                className='underline-offset-2 hover:text-[var(--text-body)] hover:underline'
              >
                {work.issue}
              </Link>
              <LinkedTickets issueKey={work.issue} />
            </span>
            <Link
              href={protoRoutes.chat(workspaceId, work.chat.id)}
              className='flex items-center gap-1.5 rounded-md px-1 hover:text-[var(--text-body)]'
            >
              <Avatar size='xs' name={work.chat.owner} />
              {`${owner}’s chat`}
            </Link>
          </span>
          <button
            type='button'
            aria-label='Voice'
            className='flex size-[26px] items-center justify-center rounded-lg hover-hover:bg-[var(--surface-hover)]'
          >
            <Mic className='size-[14px] text-[var(--text-icon)]' />
          </button>
          <button
            type='button'
            aria-label={stopped ? 'Stopped' : 'Stop'}
            disabled={stopped}
            onClick={() => setStopped(true)}
            className='flex size-[26px] items-center justify-center rounded-full bg-[var(--text-primary)] disabled:opacity-30'
          >
            <span className='size-[8px] rounded-[2px] bg-[var(--bg)]' />
          </button>
        </div>
      </div>
    </div>
  )
}
