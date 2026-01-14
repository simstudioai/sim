'use client'

import type { ComponentType, ReactNode, SVGProps } from 'react'
import { PopoverItem } from '@/components/emcn'
import { formatCompactTimestamp } from '@/lib/core/utils/formatting'
import {
  FOLDER_CONFIGS,
  MENU_STATE_TEXT_CLASSES,
  type MentionFolderId,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/constants'

const ICON_CONTAINER =
  'relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[4px]'

export function BlockIcon({
  bgColor,
  Icon,
}: {
  bgColor?: string
  Icon?: ComponentType<SVGProps<SVGSVGElement>>
}) {
  return (
    <div className={ICON_CONTAINER} style={{ background: bgColor || '#6B7280' }}>
      {Icon && <Icon className='!h-[10px] !w-[10px] !text-white' />}
    </div>
  )
}

export function WorkflowColorDot({ color }: { color?: string }) {
  return <div className={ICON_CONTAINER} style={{ backgroundColor: color || '#3972F6' }} />
}

interface FolderContentProps {
  /** Folder ID to render content for */
  folderId: MentionFolderId
  /** Items to render (already filtered) */
  items: any[]
  /** Whether data is loading */
  isLoading: boolean
  /** Current search query (for determining empty vs no-match message) */
  currentQuery: string
  /** Currently active item index (for keyboard navigation) */
  activeIndex: number
  /** Callback when an item is clicked */
  onItemClick: (item: any) => void
}

export function renderItemIcon(folderId: MentionFolderId, item: any): ReactNode {
  switch (folderId) {
    case 'workflows':
      return <WorkflowColorDot color={item.color} />
    case 'blocks':
    case 'workflow-blocks':
      return <BlockIcon bgColor={item.bgColor} Icon={item.iconComponent} />
    default:
      return null
  }
}

function renderItemSuffix(folderId: MentionFolderId, item: any): ReactNode {
  switch (folderId) {
    case 'templates':
      return <span className='text-[10px] text-[var(--text-muted)]'>{item.stars}</span>
    case 'logs':
      return (
        <>
          <span className='text-[10px] text-[var(--text-tertiary)]'>·</span>
          <span className='whitespace-nowrap text-[10px]'>
            {formatCompactTimestamp(item.createdAt)}
          </span>
          <span className='text-[10px] text-[var(--text-tertiary)]'>·</span>
          <span className='text-[10px] capitalize'>{(item.trigger || 'manual').toLowerCase()}</span>
        </>
      )
    default:
      return null
  }
}

export function FolderContent({
  folderId,
  items,
  isLoading,
  currentQuery,
  activeIndex,
  onItemClick,
}: FolderContentProps) {
  const config = FOLDER_CONFIGS[folderId]

  if (isLoading) {
    return <div className={MENU_STATE_TEXT_CLASSES}>Loading...</div>
  }

  if (items.length === 0) {
    return (
      <div className={MENU_STATE_TEXT_CLASSES}>
        {currentQuery ? config.noMatchMessage : config.emptyMessage}
      </div>
    )
  }

  return (
    <>
      {items.map((item, index) => (
        <PopoverItem
          key={config.getId(item)}
          onClick={() => onItemClick(item)}
          data-idx={index}
          active={index === activeIndex}
        >
          {renderItemIcon(folderId, item)}
          <span className={folderId === 'logs' ? 'min-w-0 flex-1 truncate' : 'truncate'}>
            {config.getLabel(item)}
          </span>
          {renderItemSuffix(folderId, item)}
        </PopoverItem>
      ))}
    </>
  )
}

export function FolderPreviewContent({
  folderId,
  items,
  isLoading,
  onItemClick,
}: Omit<FolderContentProps, 'currentQuery' | 'activeIndex'>) {
  const config = FOLDER_CONFIGS[folderId]

  if (isLoading) {
    return <div className={MENU_STATE_TEXT_CLASSES}>Loading...</div>
  }

  if (items.length === 0) {
    return <div className={MENU_STATE_TEXT_CLASSES}>{config.emptyMessage}</div>
  }

  return (
    <>
      {items.map((item) => (
        <PopoverItem key={config.getId(item)} onClick={() => onItemClick(item)}>
          {renderItemIcon(folderId, item)}
          <span className={folderId === 'logs' ? 'min-w-0 flex-1 truncate' : 'truncate'}>
            {config.getLabel(item)}
          </span>
          {renderItemSuffix(folderId, item)}
        </PopoverItem>
      ))}
    </>
  )
}
