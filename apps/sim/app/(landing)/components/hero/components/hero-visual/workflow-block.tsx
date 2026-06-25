import { cn } from '@/lib/core/utils/cn'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

interface WorkflowBlockProps {
  block: BlockDef
}

/**
 * The inner content of a workflow block — the icon-tile header and optional
 * label → value rows — WITHOUT the card chrome or handle nubs. Split out so the
 * chat card can host the exact same content while morphing into the first block
 * (the card keeps its own continuous shell; only this content crossfades in).
 */
export function WorkflowBlockContent({ block }: WorkflowBlockProps) {
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

/**
 * The decorative edge-handle nubs for a block — an inbound nub on the left
 * unless the block is a trigger, an outbound nub on the right unless it's
 * terminal. Absolutely positioned, so the caller must be a `relative` (or
 * otherwise positioned) box of the block's width. Shared so the morphed chat
 * card (GitHub, rendered as content-only) can carry the same handles as the
 * real {@link WorkflowBlock} satellites.
 */
export function BlockHandles({ block }: WorkflowBlockProps) {
  return (
    <>
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
    </>
  )
}

/**
 * A pure presentational workflow block card, faithful to the real WorkflowBlock:
 * a fixed-width card with an icon-tile header and optional label → value rows,
 * plus decorative handle nubs on its left and right edges. Stateless and
 * client-free — positioning and the rise animation are owned by the parent stage.
 */
export function WorkflowBlock({ block }: WorkflowBlockProps) {
  return (
    <div className='relative w-[250px] rounded-[13px] border border-[var(--border-1)] bg-[var(--surface-2)] shadow-sm'>
      <WorkflowBlockContent block={block} />
      <BlockHandles block={block} />
    </div>
  )
}
