import { AgentIcon, AnthropicIcon } from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'

/**
 * FormationGraph — the Formation beat's callout: several agents running in
 * parallel that fan *in* to one merged result. Deliberately the inverse shape of
 * every other beat (linear trigger → agent → action), and of the workflow behind
 * it — so it reads as "many agents on one problem," not another branching flow.
 *
 * Free-form (no white block): the agent cards sit directly on the faded platform
 * backdrop, wired with `#c9c9c9` bezier edges, exactly as they read on the
 * canvas. The three parallel agents carry a live "Running" status; they converge
 * on a single Synthesis agent that merges their work. Decorative (`aria-hidden`).
 */
const CARD =
  'absolute w-[184px] rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-2)]'
const TILE =
  'flex size-[24px] flex-shrink-0 items-center justify-center rounded-[6px] bg-[var(--text-body)]'

interface AgentCardProps {
  className: string
  name: string
  /** Live status shown on the parallel agents (omitted on the merge node). */
  status?: string
  /** Model row shown on the merge node. */
  model?: string
}

function AgentCard({ className, name, status, model }: AgentCardProps) {
  return (
    <div className={cn(CARD, className)}>
      <div
        className={cn('flex items-center gap-2.5 p-2', model && 'border-[var(--border)] border-b')}
      >
        <div className={TILE}>
          <AgentIcon className='size-[16px] text-white' />
        </div>
        <span className='min-w-0 flex-1 truncate font-medium text-[15px] text-[var(--text-primary)]'>
          {name}
        </span>
        {status && (
          <span className='flex flex-shrink-0 items-center gap-1.5 text-[12px] text-[var(--text-muted)]'>
            <span className='size-[6px] rounded-full bg-[#3ba55d]' />
            {status}
          </span>
        )}
      </div>
      {model && (
        <div className='flex items-center gap-2 p-2'>
          <span className='flex-shrink-0 text-[14px] text-[var(--text-muted)]'>Model</span>
          <span className='flex min-w-0 flex-1 items-center justify-end gap-2 text-[14px] text-[var(--text-primary)]'>
            <AnthropicIcon className='inline-block size-[14px] flex-shrink-0 text-[var(--text-primary)]' />
            <span className='truncate'>claude-opus-4.8</span>
          </span>
        </div>
      )}
    </div>
  )
}

export function FormationGraph() {
  return (
    <div aria-hidden='true' className='relative h-[300px] w-[520px]'>
      {/* Edge layer — three parallel agents fanning in to the merge node. */}
      <svg className='absolute inset-0 h-full w-full' fill='none' aria-hidden='true'>
        <path d='M184,28 C260,28 256,140 332,140' stroke='var(--surface-7)' strokeWidth='1.5' />
        <path d='M184,140 C260,140 256,140 332,140' stroke='var(--surface-7)' strokeWidth='1.5' />
        <path d='M184,252 C260,252 256,140 332,140' stroke='var(--surface-7)' strokeWidth='1.5' />
      </svg>

      <AgentCard className='top-[8px] left-0' name='Research Agent' status='Running' />
      <AgentCard className='top-[120px] left-0' name='Analysis Agent' status='Running' />
      <AgentCard className='top-[232px] left-0' name='Draft Agent' status='Running' />
      <AgentCard className='top-[106px] left-[332px]' name='Synthesis' model='claude-opus-4.8' />
    </div>
  )
}
