'use client'

/**
 * TEMPORARY preview harness (delete before merge). Designs the in-chat working
 * indicator: ONE shimmering status line by default, escalating to a per-agent
 * breakout ONLY while ≥2 agents run concurrently, then collapsing back to a
 * single line and the reply.
 */
import { useEffect, useState } from 'react'
import {
  ParallelAgents,
  ShimmerStatus,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/activity-view'

type Frame =
  | { kind: 'line'; text: string }
  | { kind: 'parallel'; header: string; agents: { label: string; phrase: string }[] }

interface Scene {
  key: string
  label: string
  prompt: string
  frames: Frame[]
  reply: string
}

const line = (text: string): Frame => ({ kind: 'line', text })

const SCENES: Scene[] = [
  {
    key: 'crm',
    label: 'Build CRM',
    prompt: 'build a simple crm page',
    frames: [
      line('Reviewing UX requirements and data model'),
      line('Exploring CRM page structure and data flow'),
      line('Drafting a clean CRM page layout'),
      line('Wiring up the contacts table'),
    ],
    reply: 'Done — your CRM page is ready. Open it on the right.',
  },
  {
    key: 'parallel',
    label: 'Parallel agents',
    prompt: 'Polish my profile — refresh my skills and bio',
    frames: [
      line('Reviewing your profile'),
      {
        kind: 'parallel',
        header: 'Profile scan · 2 agents',
        agents: [
          { label: 'Skills', phrase: 'Scanning your experience' },
          { label: 'Biography', phrase: 'Reading your current bio' },
        ],
      },
      {
        kind: 'parallel',
        header: 'Profile scan · 2 agents',
        agents: [
          { label: 'Skills', phrase: 'Determining relevant changes' },
          { label: 'Biography', phrase: 'Crafting a proposal' },
        ],
      },
      {
        kind: 'parallel',
        header: 'Profile scan · 2 agents',
        agents: [
          { label: 'Skills', phrase: 'Finalizing skill updates' },
          { label: 'Biography', phrase: 'Polishing the wording' },
        ],
      },
      line('Wrapping up'),
    ],
    reply: 'Updated your skills and bio — review the changes on the right.',
  },
  {
    key: 'edit',
    label: 'Edit dialog',
    prompt: 'Add an edit dialog to update contact details without deleting them',
    frames: [
      line('Reviewing edit dialog integration plans'),
      line('Adding the edit form'),
      line('Saving changes in place'),
    ],
    reply: 'Added an edit dialog — contacts now update in place.',
  },
]

const FRAME_MS = 1900

export default function ActivityPreviewPage() {
  const [sceneKey, setSceneKey] = useState(SCENES[0].key)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(true)

  const scene = SCENES.find((s) => s.key === sceneKey) ?? SCENES[0]
  const total = scene.frames.length
  const done = idx >= total
  const frame = done ? null : scene.frames[idx]

  useEffect(() => {
    setIdx(0)
    setPlaying(true)
  }, [sceneKey])

  useEffect(() => {
    if (!playing) return
    if (idx >= total) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setIdx((i) => Math.min(i + 1, total)), FRAME_MS)
    return () => clearTimeout(t)
  }, [playing, idx, total])

  return (
    <div className='flex h-screen flex-col bg-[var(--bg)] p-[24px]'>
      <div className='mb-[16px] flex flex-wrap items-center gap-[8px]'>
        {SCENES.map((s) => (
          <button
            key={s.key}
            type='button'
            onClick={() => setSceneKey(s.key)}
            className={`rounded-[6px] px-[10px] py-[5px] text-[13px] ${
              s.key === sceneKey
                ? 'bg-[var(--surface-6)] text-[var(--text-primary)]'
                : 'bg-[var(--surface-4)] text-[var(--text-secondary)]'
            }`}
          >
            {s.label}
          </button>
        ))}
        <div className='ml-auto flex items-center gap-[6px]'>
          <button
            type='button'
            onClick={() => {
              setPlaying(false)
              setIdx((i) => Math.max(0, i - 1))
            }}
            className='rounded-[6px] bg-[var(--surface-4)] px-[10px] py-[5px] text-[13px] text-[var(--text-secondary)]'
          >
            ‹ Prev
          </button>
          <button
            type='button'
            onClick={() => {
              if (done) {
                setIdx(0)
                setPlaying(true)
              } else {
                setPlaying((p) => !p)
              }
            }}
            className='rounded-[6px] bg-[var(--surface-6)] px-[12px] py-[5px] text-[13px] text-[var(--text-primary)]'
          >
            {done ? '↻ Replay' : playing ? 'Pause' : 'Play'}
          </button>
          <button
            type='button'
            onClick={() => {
              setPlaying(false)
              setIdx((i) => Math.min(total, i + 1))
            }}
            className='rounded-[6px] bg-[var(--surface-4)] px-[10px] py-[5px] text-[13px] text-[var(--text-secondary)]'
          >
            Next ›
          </button>
          <span className='ml-[4px] w-[44px] text-right text-[12px] text-[var(--text-muted)]'>
            {Math.min(idx, total)}/{total}
          </span>
        </div>
      </div>

      <div className='flex min-h-0 flex-1 justify-center overflow-y-auto'>
        <div className='flex w-full max-w-[640px] flex-col gap-[20px] py-[24px]'>
          <div className='flex justify-end'>
            <div className='max-w-[80%] rounded-[14px] bg-[var(--surface-5)] px-[14px] py-[10px] text-[14px] text-[var(--text-primary)]'>
              {scene.prompt}
            </div>
          </div>

          {done ? (
            <p className='animate-stream-fade-in text-[15px] text-[var(--text-primary)] leading-[24px]'>
              {scene.reply}
            </p>
          ) : frame?.kind === 'parallel' ? (
            <ParallelAgents header={frame.header} agents={frame.agents} active={playing} />
          ) : (
            <ShimmerStatus text={frame?.text ?? ''} active={playing} />
          )}
        </div>
      </div>
    </div>
  )
}
