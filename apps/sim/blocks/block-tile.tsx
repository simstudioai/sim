'use client'

import type { ComponentType, HTMLAttributes } from 'react'
import { chipIconSlotClass, cn } from '@sim/emcn'
import { WorkflowTypeIcon } from '@sim/workflow-renderer'
import { getBlockTileColor, getBlockTileIcon, hasBlockAccent } from '@/blocks/accent'
import { getTileIconColorClass } from '@/blocks/icon-color'

/**
 * Slot sizes the tile ships in: the 18px detail header, the canvas 16px chip,
 * or 14px for dense rows.
 */
const TILE_SIZE_CLASS = {
  lg: 'size-[18px]',
  md: 'size-[16px]',
  sm: 'size-[14px]',
} as const

/** Icon drawn inside each slot. Only the header tile takes the larger glyph. */
const TILE_ICON_SIZE_CLASS = {
  lg: 'size-[12px]',
  md: 'size-[10px]',
  sm: 'size-[10px]',
} as const

export interface BlockTileProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'style'> {
  /**
   * Block the tile represents; decides whether it takes the canvas role accent.
   * Omitted by rows that name no block — a catalog integration, a section
   * header — which keep their own fill. @see hasBlockAccent
   */
  blockType?: string
  /** Defaults to the block's registered icon. */
  icon?: ComponentType<{ className?: string }>
  /** Provider fill, used only when the block takes no accent. */
  bgColor?: string
  /** Drawn on the provider tile when there is no icon — usually a name initial. */
  fallbackLabel?: string
  size?: keyof typeof TILE_SIZE_CLASS
}

/**
 * The one block tile. Renders the shared canvas accent chip for anything that
 * carries a role and the block's provider tile for everything else, so a block
 * reads the same in every list it appears in. @see hasBlockAccent
 *
 * The tile owns its icon colour outright, which is why the contrast class is
 * always the `!important` variant: these rows live inside popover, combobox and
 * command surfaces that paint descendants through `[&_svg]:text-*`, and a plain
 * utility on the icon loses to that parent rule — pale brand tiles would render
 * their icon white-on-white.
 *
 * Reaches the block registry, so it is for workspace surfaces only. Public
 * marketing pages keep their own tile rather than pull every block config into
 * that bundle — see `@/blocks/icon-color`.
 */
export function BlockTile({
  blockType,
  icon,
  bgColor,
  fallbackLabel,
  size = 'md',
  className,
  ...props
}: BlockTileProps) {
  const Icon = icon ?? (blockType ? getBlockTileIcon(blockType) : undefined)
  const sizeClass = cn(TILE_SIZE_CLASS[size], className)
  const iconSizeClass = TILE_ICON_SIZE_CLASS[size]

  if (blockType && Icon && hasBlockAccent(blockType)) {
    return (
      <WorkflowTypeIcon
        type={blockType}
        Icon={Icon}
        className={sizeClass}
        iconClassName={iconSizeClass}
        {...props}
      />
    )
  }

  const fill = bgColor ?? (blockType ? getBlockTileColor(blockType) : undefined)

  return (
    <div
      className={cn(chipIconSlotClass, 'overflow-hidden rounded-md [&_img]:size-full', sizeClass)}
      style={{ background: fill }}
      {...props}
    >
      {Icon ? (
        <Icon
          className={cn(
            iconSizeClass,
            'transition-transform duration-100 group-hover:scale-110',
            getTileIconColorClass(fill, true)
          )}
        />
      ) : (
        fallbackLabel && (
          <span className={cn('font-bold text-micro', getTileIconColorClass(fill, true))}>
            {fallbackLabel}
          </span>
        )
      )}
    </div>
  )
}
