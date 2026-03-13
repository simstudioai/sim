'use client'

import { X } from 'lucide-react'
import { Badge } from '@/components/emcn'
import { Database, File as FileIcon, Table as TableIcon } from '@/components/emcn/icons'
import { WorkflowIcon } from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'
import type { ChatContext } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface ContextPillsProps {
  contexts: ChatContext[]
  onRemoveContext: (context: ChatContext) => void
}

function WorkflowPillIcon({ workflowId, className }: { workflowId: string; className?: string }) {
  const color = useWorkflowRegistry((state) => state.workflows[workflowId]?.color ?? '#888')
  return (
    <div
      className={cn('flex-shrink-0 rounded-[3px] border-[2px]', className)}
      style={{
        backgroundColor: color,
        borderColor: `${color}60`,
        backgroundClip: 'padding-box',
      }}
    />
  )
}

function getContextIcon(ctx: ChatContext) {
  switch (ctx.kind) {
    case 'workflow':
    case 'current_workflow':
      return (
        <WorkflowPillIcon
          workflowId={ctx.workflowId}
          className='mr-[4px] h-[10px] w-[10px]'
        />
      )
    case 'workflow_block':
      return (
        <WorkflowPillIcon
          workflowId={ctx.workflowId}
          className='mr-[4px] h-[10px] w-[10px]'
        />
      )
    case 'knowledge':
      return <Database className='mr-[4px] h-[10px] w-[10px] text-[var(--text-icon)]' />
    case 'templates':
      return <WorkflowIcon className='mr-[4px] h-[10px] w-[10px] text-[var(--text-icon)]' />
    case 'past_chat':
      return null
    case 'logs':
      return <FileIcon className='mr-[4px] h-[10px] w-[10px] text-[var(--text-icon)]' />
    case 'blocks':
      return <TableIcon className='mr-[4px] h-[10px] w-[10px] text-[var(--text-icon)]' />
    case 'table':
      return <TableIcon className='mr-[4px] h-[10px] w-[10px] text-[var(--text-icon)]' />
    case 'file':
      return <FileIcon className='mr-[4px] h-[10px] w-[10px] text-[var(--text-icon)]' />
    case 'docs':
      return <FileIcon className='mr-[4px] h-[10px] w-[10px] text-[var(--text-icon)]' />
    default:
      return null
  }
}

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
          {getContextIcon(ctx)}
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
