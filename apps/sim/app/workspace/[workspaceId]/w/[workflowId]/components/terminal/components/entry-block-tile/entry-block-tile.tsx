'use client'

import { memo } from 'react'
import { chipIconSlotClass, cn } from '@sim/emcn'
import { WorkflowTypeIcon } from '@sim/workflow-renderer'
import {
  getBlockColor,
  getBlockIcon,
  getEntryAccentType,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/utils'
import { getTileIconColorClass } from '@/blocks/icon-color'

export interface EntryBlockTileProps {
  blockType: string
}

/** A log row's block tile. @see getEntryAccentType */
export const EntryBlockTile = memo(function EntryBlockTile({ blockType }: EntryBlockTileProps) {
  const BlockIcon = getBlockIcon(blockType)
  const bgColor = getBlockColor(blockType)
  const accentType = getEntryAccentType(blockType)

  if (BlockIcon && accentType) {
    return <WorkflowTypeIcon type={accentType} Icon={BlockIcon} />
  }

  return (
    <div
      className={cn(chipIconSlotClass, 'overflow-hidden rounded-md [&_img]:size-full')}
      style={{ background: bgColor }}
    >
      {BlockIcon && <BlockIcon className={cn('size-[10px]', getTileIconColorClass(bgColor))} />}
    </div>
  )
})
