'use client'

import { ShimmerStatus } from './shimmer-status'

interface ParallelAgent {
  label: string
  phrase: string
}

interface ParallelAgentsProps {
  /** Compact summary line, e.g. "Profile scan · 2 agents". */
  header: string
  agents: ParallelAgent[]
  /** Animate the per-agent shimmer (true while concurrently working). */
  active?: boolean
}

/**
 * The ONLY sanctioned breakout: shown solely while ≥2 agents run concurrently,
 * because a single line can't express concurrency. Each agent still gets just
 * one shimmering line (the atom) under a shared header. Collapses back to a
 * single line the instant agents stop running in parallel.
 */
export function ParallelAgents({ header, agents, active = true }: ParallelAgentsProps) {
  return (
    <div className='flex animate-stream-fade-in flex-col gap-[12px]'>
      <span className='text-[13px] text-[var(--text-muted)]'>{header}</span>
      <div className='flex flex-col gap-[14px] border-[var(--divider)] border-l pl-[16px]'>
        {agents.map((a) => (
          <div key={a.label} className='flex flex-col gap-[3px]'>
            <span className='text-[13px] text-[var(--text-secondary)]'>{a.label}</span>
            <ShimmerStatus text={a.phrase} active={active} />
          </div>
        ))}
      </div>
    </div>
  )
}
