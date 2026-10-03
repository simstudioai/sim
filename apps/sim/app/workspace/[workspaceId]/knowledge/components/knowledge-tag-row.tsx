import type { MouseEventHandler, ReactNode } from 'react'
import { Button, cn } from '@sim/emcn'
import { Trash } from '@sim/emcn/icons'

interface KnowledgeTagRowProps {
  name: string
  typeLabel: string
  detail: ReactNode
  truncateDetail?: boolean
  activateLabel: string
  removeLabel: string
  onActivate: MouseEventHandler<HTMLButtonElement>
  onRemove: MouseEventHandler<HTMLButtonElement>
}

/** Shared tag summary; callers retain activation, keyboard and removal behavior. */
export function KnowledgeTagRow({
  name,
  typeLabel,
  detail,
  truncateDetail = false,
  activateLabel,
  removeLabel,
  onActivate,
  onRemove,
}: KnowledgeTagRowProps) {
  return (
    <div className='flex items-center rounded-sm border hover-hover:bg-[var(--surface-2)]'>
      <button
        type='button'
        onClick={onActivate}
        aria-label={activateLabel}
        className='flex min-w-0 flex-1 cursor-pointer items-center gap-2 p-2 text-left'
      >
        <span className='min-w-0 truncate text-[var(--text-primary)] text-caption'>{name}</span>
        <span className='rounded-sm bg-[var(--surface-3)] px-1.5 py-0.5 text-[var(--text-muted)] text-micro'>
          {typeLabel}
        </span>
        <span
          aria-hidden='true'
          className='mb-[-1.5px] h-[14px] w-[1.25px] shrink-0 rounded-full bg-[var(--border-1)]'
        />
        <span
          className={cn(
            'min-w-0 flex-1 text-[var(--text-muted)] text-caption',
            truncateDetail && 'truncate'
          )}
        >
          {detail}
        </span>
      </button>
      <Button
        aria-label={removeLabel}
        variant='ghost-destructive-muted'
        onClick={onRemove}
        size='icon'
        className='mr-2'
      >
        <Trash className='size-3' />
      </Button>
    </div>
  )
}
