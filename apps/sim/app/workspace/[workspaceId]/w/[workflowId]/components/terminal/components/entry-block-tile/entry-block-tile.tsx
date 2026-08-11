'use client'

import { memo } from 'react'
import { WorkflowTypeIcon } from '@sim/workflow-renderer'
import clsx from 'clsx'
import {
  getBlockColor,
  getBlockIcon,
  getEntryAccentType,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/utils'
import { getTileIconColorClass } from '@/blocks/icon-color'

export interface EntryBlockTileProps {
  blockType: string
}

/**
 * A log row's block tile.
 *
 * Accented through the canvas's own derivation, so a row reads as the card it
 * ran from rather than as a second, unrelated colour scheme.
 */
export const EntryBlockTile = memo(function EntryBlockTile({ blockType }: EntryBlockTileProps) {
  const BlockIcon = getBlockIcon(blockType)
  const bgColor = getBlockColor(blockType)
  const accentType = getEntryAccentType(blockType)

  if (BlockIcon && accentType) {
    return <WorkflowTypeIcon type={accentType} Icon={BlockIcon} />
  }

  return (
    <div
      className='flex size-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-md [&_img]:size-full'
      style={{ background: bgColor }}
    >
      {BlockIcon && <BlockIcon className={clsx('size-[10px]', getTileIconColorClass(bgColor))} />}
    </div>
  )
})
