import { Check, cn } from '@sim/emcn'
import type { AgentPlanItem } from '@/lib/mothership/request/types'

interface PlanChecklistProps {
  items: AgentPlanItem[]
}

/**
 * The agent's live plan: one card, updated in place as the worker's
 * update_plan tool replaces the list. Read-only — progress display, not an
 * input surface.
 */
export function PlanChecklist({ items }: PlanChecklistProps) {
  if (items.length === 0) return null

  return (
    <div className='my-1 rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2'>
      <div className='flex flex-col gap-1'>
        {items.map((item, index) => (
          <div key={`${index}-${item.step}`} className='flex items-start gap-2'>
            <span
              className={cn(
                'mt-[3px] flex size-[14px] shrink-0 items-center justify-center rounded-full border',
                item.status === 'done' && 'border-[var(--brand-accent)] bg-[var(--brand-accent)]',
                item.status === 'active' && 'border-[var(--text-primary)]',
                item.status === 'pending' && 'border-[var(--border-1)]'
              )}
            >
              {item.status === 'done' && <Check className='size-[9px] text-[var(--bg)]' />}
              {item.status === 'active' && (
                <span className='size-[6px] animate-pulse rounded-full bg-[var(--text-primary)]' />
              )}
            </span>
            <span
              className={cn(
                'font-[family-name:var(--font-inter)] text-[13px] leading-[19px]',
                item.status === 'done' && 'text-[var(--text-tertiary)] line-through',
                item.status === 'active' && 'font-medium text-[var(--text-primary)]',
                item.status === 'pending' && 'text-[var(--text-secondary)]'
              )}
            >
              {item.step}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
