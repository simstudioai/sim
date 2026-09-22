import type { HTMLAttributes, MouseEventHandler, ReactNode } from 'react'
import { Button, cn } from '@sim/emcn'
import { Trash } from '@sim/emcn/icons'

interface KnowledgeTagRowProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'> {
  name: string
  typeLabel: string
  detail: ReactNode
  truncateDetail?: boolean
  removeLabel: string
  onRemove: MouseEventHandler<HTMLButtonElement>
}

/** Shared tag summary; callers retain activation, keyboard and removal behavior. */
export function KnowledgeTagRow({
  name,
  typeLabel,
  detail,
  truncateDetail = false,
  removeLabel,
  onRemove,
  ...props
}: KnowledgeTagRowProps) {
  return (
    <div
      {...props}
      className='flex cursor-pointer items-center gap-2 rounded-sm border p-2 hover-hover:bg-[var(--surface-2)]'
    >
      <span className='min-w-0 truncate text-[var(--text-primary)] text-caption'>{name}</span>
      <span className='rounded-[3px] bg-[var(--surface-3)] px-1.5 py-0.5 text-[var(--text-muted)] text-micro'>
        {typeLabel}
      </span>
      <div className='mb-[-1.5px] h-[14px] w-[1.25px] shrink-0 rounded-full bg-[var(--border-1)]' />
      <span
        className={cn(
          'min-w-0 flex-1 text-[var(--text-muted)] text-caption',
          truncateDetail && 'truncate'
        )}
      >
        {detail}
      </span>
      <div className='flex shrink-0 items-center gap-1'>
        <Button
          aria-label={removeLabel}
          variant='ghost-destructive-muted'
          onClick={onRemove}
          size='icon'
        >
          <Trash className='size-3' />
        </Button>
      </div>
    </div>
  )
}
