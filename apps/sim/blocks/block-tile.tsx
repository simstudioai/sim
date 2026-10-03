'use client'

import { BlockTileView, type BlockTileViewProps } from '@sim/workflow-renderer'
import { getBlockTileColor, getBlockTileIcon, hasBlockAccent } from '@/blocks/accent'

export interface BlockTileProps extends Omit<BlockTileViewProps, 'useAccent'> {}

/** Resolves workspace registry metadata for the shared block tile. */
export function BlockTile({ blockType, icon, bgColor, ...props }: BlockTileProps) {
  return (
    <BlockTileView
      {...props}
      blockType={blockType}
      icon={icon ?? (blockType ? getBlockTileIcon(blockType) : undefined)}
      bgColor={bgColor ?? (blockType ? getBlockTileColor(blockType) : undefined)}
      useAccent={Boolean(blockType && hasBlockAccent(blockType))}
    />
  )
}
