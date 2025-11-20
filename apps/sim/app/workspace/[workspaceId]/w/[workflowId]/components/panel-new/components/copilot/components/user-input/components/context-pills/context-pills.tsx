'use client'

import { X } from 'lucide-react'
import { Badge } from '@/components/emcn'
import type { ChatContext } from '@/stores/panel-new/copilot/types'

interface ContextPillsProps {
  /** Selected contexts to display as pills */
  contexts: ChatContext[]
  /** Callback when a context pill is removed */
  onRemoveContext: (context: ChatContext) => void
}

/**
 * Displays selected contexts as dismissible pills matching the @ badge style.
 * Filters out current_workflow contexts as they are always implied.
 *
 * @param props - Component props
 * @returns Rendered context pills or null if no visible contexts
 */
export function ContextPills({ contexts, onRemoveContext }: ContextPillsProps) {
  const visibleContexts = contexts.filter((c) => c.kind !== 'current_workflow')

  if (visibleContexts.length === 0) {
    return null
  }

  return (
    <>
      {visibleContexts.map((ctx, idx) => (
        <Badge
          key={`selctx-${idx}-${ctx.label}`}
          variant='outline'
          className='inline-flex items-center gap-1 rounded-[6px] px-2 py-[4.5px] text-xs leading-[12px]'
          title={ctx.label}
        >
          <span className='max-w-[140px] truncate leading-[12px]'>{ctx.label}</span>
          <button
            type='button'
            onClick={() => onRemoveContext(ctx)}
            className='text-muted-foreground transition-colors hover:text-foreground'
            title='Remove context'
            aria-label='Remove context'
          >
            <X className='h-3 w-3' strokeWidth={1.75} />
          </button>
        </Badge>
      ))}
    </>
  )
}
