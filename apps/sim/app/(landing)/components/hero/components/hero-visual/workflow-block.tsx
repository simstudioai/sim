import { cn } from '@/lib/core/utils/cn'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

interface WorkflowBlockProps {
  block: BlockDef
}

/**
 * A pure presentational workflow block card, faithful to the real WorkflowBlock:
 * a fixed-width card with an icon-tile header and optional label → value rows,
 * plus decorative handle nubs on its left and right edges. Stateless and
 * client-free — positioning and the rise animation are owned by the parent stage.
 */
export function WorkflowBlock({ block }: WorkflowBlockProps) {
  return (
    <div className='relative w-[250px] rounded-lg border border-[var(--border-1)] bg-[var(--surface-2)]'>
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

      {!block.isTrigger && (
        <span
          aria-hidden
          className='-translate-y-1/2 absolute top-5 left-[-7px] h-5 w-[7px] rounded-l-[2px] bg-[var(--workflow-edge)]'
        />
      )}
      {!block.isTerminal && (
        <span
          aria-hidden
          className='-translate-y-1/2 absolute top-5 right-[-7px] h-5 w-[7px] rounded-r-[2px] bg-[var(--workflow-edge)]'
        />
      )}
    </div>
  )
}
