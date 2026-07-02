import { cn } from '@sim/emcn'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

interface WorkflowBlockContentProps {
  block: BlockDef
}

/**
 * The inner content of a workflow block - the icon-tile header and optional
 * label → value rows - WITHOUT the card chrome or handle nubs. Split out so the
 * chat card can host the exact same content while morphing into the first block
 * (the card keeps its own continuous shell; only this content crossfades in).
 */
export function WorkflowBlockContent({ block }: WorkflowBlockContentProps) {
  return (
    <>
      <div
        className={cn(
          'flex items-center gap-2.5 p-2',
          block.rows.length > 0 && 'border-[var(--border-1)] border-b'
        )}
      >
        <div
          className={cn(
            'flex size-[24px] flex-shrink-0 items-center justify-center rounded-md',
            block.tileBorder && 'border border-[var(--border-1)]'
          )}
          style={{ background: block.bgColor }}
        >
          {block.tileBorder ? (
            <block.icon className='size-[16px]' />
          ) : (
            <block.icon className='size-[16px] text-white' />
          )}
        </div>
        <span className='truncate font-medium text-[16px] text-[var(--text-body)]'>
          {block.name}
        </span>
      </div>

      {block.rows.length > 0 && (
        <div className='flex flex-col gap-2 p-2'>
          {block.rows.map((row) => (
            <div key={row.title} className='flex items-center gap-2'>
              <span className='flex-shrink-0 text-[14px] text-[var(--text-muted)]'>
                {row.title}
              </span>
              <span className='flex min-w-0 flex-1 items-center justify-end gap-1.5 text-[14px] text-[var(--text-body)]'>
                {row.valueIcon && <row.valueIcon className='size-[14px] flex-shrink-0' />}
                <span className='truncate'>{row.value}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
