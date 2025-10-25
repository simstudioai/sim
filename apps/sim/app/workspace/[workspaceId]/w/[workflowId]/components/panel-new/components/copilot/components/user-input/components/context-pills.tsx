'use client'

import {
  Blocks,
  BookOpen,
  Bot,
  Box,
  Info,
  LibraryBig,
  Shapes,
  SquareChevronRight,
  Workflow,
  X,
} from 'lucide-react'
import type { ChatContext } from '@/stores/panel-new/copilot/types'

interface ContextPillsProps {
  /** Selected contexts to display as pills */
  contexts: ChatContext[]
  /** Callback when a context pill is removed */
  onRemoveContext: (label: string) => void
}

/**
 * Displays selected contexts as dismissible pills with appropriate icons.
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
    <div className='mb-2 flex flex-wrap gap-1.5'>
      {visibleContexts.map((ctx, idx) => (
        <span
          key={`selctx-${idx}-${ctx.label}`}
          className='inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--brand-primary-hover-hex)_14%,transparent)] px-1.5 py-0.5 text-[11px] text-foreground'
          title={ctx.label}
        >
          {ctx.kind === 'past_chat' ? (
            <Bot className='h-3 w-3 text-muted-foreground' />
          ) : ctx.kind === 'workflow' ? (
            <Workflow className='h-3 w-3 text-muted-foreground' />
          ) : ctx.kind === 'blocks' ? (
            <Blocks className='h-3 w-3 text-muted-foreground' />
          ) : ctx.kind === 'workflow_block' ? (
            <Box className='h-3 w-3 text-muted-foreground' />
          ) : ctx.kind === 'knowledge' ? (
            <LibraryBig className='h-3 w-3 text-muted-foreground' />
          ) : ctx.kind === 'templates' ? (
            <Shapes className='h-3 w-3 text-muted-foreground' />
          ) : ctx.kind === 'docs' ? (
            <BookOpen className='h-3 w-3 text-muted-foreground' />
          ) : ctx.kind === 'logs' ? (
            <SquareChevronRight className='h-3 w-3 text-muted-foreground' />
          ) : (
            <Info className='h-3 w-3 text-muted-foreground' />
          )}
          <span className='max-w-[140px] truncate'>{ctx.label}</span>
          <button
            type='button'
            onClick={() => onRemoveContext(ctx.label || '')}
            className='text-muted-foreground transition-colors hover:text-foreground'
            title='Remove context'
            aria-label='Remove context'
          >
            <X className='h-3 w-3' />
          </button>
        </span>
      ))}
    </div>
  )
}
