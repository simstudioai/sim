'use client'

import { memo } from 'react'
import {
  getBlockColor,
  getBlockIcon,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/utils'
import { BlockTile } from '@/blocks/block-tile'

export interface EntryBlockTileProps {
  blockType: string
}

/** A log row's block tile. @see BlockTile */
export const EntryBlockTile = memo(function EntryBlockTile({ blockType }: EntryBlockTileProps) {
  return (
    <BlockTile
      blockType={blockType}
      icon={getBlockIcon(blockType) ?? undefined}
      bgColor={getBlockColor(blockType)}
    />
  )
})
