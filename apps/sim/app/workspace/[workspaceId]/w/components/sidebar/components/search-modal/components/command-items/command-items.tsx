'use client'

import type { ComponentType, KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import { memo } from 'react'
import { ChipTag, cn } from '@sim/emcn'
import { File, Pin, Workflow } from '@sim/emcn/icons'
import { getMappedWorkflowTypeAccent } from '@sim/workflow-renderer'
import { Command } from 'cmdk'
import type { CommandItemProps } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import { COMMAND_ITEM_CLASSNAME } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import { getTileIconColorClass } from '@/blocks/icon-color'

interface ResultAdornmentProps {
  meta?: string
  pinned?: boolean
  onTogglePin?: () => void
}

function stopRowSelection(event: PointerEvent<HTMLButtonElement>) {
  event.preventDefault()
  event.stopPropagation()
}

function stopEnterRowSelection(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key === 'Enter') event.stopPropagation()
}

interface PinButtonProps {
  pinned?: boolean
  onTogglePin: () => void
  hasOtherRightContent: boolean
}

function PinButton({ pinned, onTogglePin, hasOtherRightContent }: PinButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onTogglePin()
  }

  return (
    <button
      type='button'
      aria-label={pinned ? 'Remove from favorites' : 'Add to favorites'}
      aria-pressed={pinned}
      className={cn(
        'flex-shrink-0 pl-1 opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100',
        pinned ? 'text-[var(--text-body)] opacity-100' : 'text-[var(--text-icon)]',
        !hasOtherRightContent && 'ml-auto'
      )}
      onKeyDown={stopEnterRowSelection}
      onPointerDown={stopRowSelection}
      onPointerUp={stopRowSelection}
      onClick={handleClick}
    >
      <Pin className='size-[12px]' />
    </button>
  )
}

interface ItemMetaProps {
  meta: string
}

function ItemMeta({ meta }: ItemMetaProps) {
  return (
    <span className='ml-auto flex-shrink-0 pl-2 text-[var(--text-subtle)] text-small'>{meta}</span>
  )
}

export const MemoizedCommandItem = memo(
  function CommandItem({
    value,
    onSelect,
    icon: Icon,
    bgColor,
    showColoredIcon,
    workflowType,
    label,
    meta,
    pinned,
    onTogglePin,
  }: CommandItemProps) {
    const workflowAccent = workflowType ? getMappedWorkflowTypeAccent(workflowType) : null

    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        {workflowAccent ? (
          <ChipTag
            variant={workflowAccent.variant}
            tone={workflowAccent.tone}
            className='size-[16px] flex-shrink-0 justify-center p-0'
          >
            <Icon className='size-[10px] transition-transform duration-100 group-hover:scale-110' />
          </ChipTag>
        ) : (
          <div
            className='relative flex size-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-sm [&_img]:size-full'
            style={{ background: showColoredIcon ? bgColor : 'transparent' }}
          >
            <Icon
              className={cn(
                'transition-transform duration-100 group-hover:scale-110',
                showColoredIcon
                  ? `size-[10px] ${getTileIconColorClass(bgColor)}`
                  : 'size-[16px] text-[var(--text-icon)]'
              )}
            />
          </div>
        )}
        <span className='truncate text-[var(--text-body)]'>{label}</span>
        {meta && <ItemMeta meta={meta} />}
        {onTogglePin && (
          <PinButton
            pinned={pinned}
            onTogglePin={onTogglePin}
            hasOtherRightContent={Boolean(meta)}
          />
        )}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.icon === next.icon &&
    prev.bgColor === next.bgColor &&
    prev.showColoredIcon === next.showColoredIcon &&
    prev.workflowType === next.workflowType &&
    prev.label === next.label &&
    prev.meta === next.meta &&
    prev.pinned === next.pinned
)

export const MemoizedActionItem = memo(
  function ActionItem({
    value,
    onSelect,
    icon: Icon,
    name,
    shortcut,
    meta,
    pinned,
    onTogglePin,
  }: {
    value: string
    onSelect: () => void
    icon: ComponentType<{ className?: string }>
    name: string
    shortcut?: string
  } & ResultAdornmentProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <Icon className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
        <span className='truncate text-[var(--text-body)]'>{name}</span>
        {meta ? (
          <ItemMeta meta={meta} />
        ) : shortcut ? (
          <span className='ml-auto flex-shrink-0 text-[var(--text-subtle)] text-small'>
            {shortcut}
          </span>
        ) : null}
        {onTogglePin && (
          <PinButton
            pinned={pinned}
            onTogglePin={onTogglePin}
            hasOtherRightContent={Boolean(meta || shortcut)}
          />
        )}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.icon === next.icon &&
    prev.name === next.name &&
    prev.shortcut === next.shortcut &&
    prev.meta === next.meta &&
    prev.pinned === next.pinned
)

export const MemoizedWorkflowItem = memo(
  function WorkflowItem({
    value,
    onSelect,
    name,
    folderPath,
    isCurrent,
    meta,
    pinned,
    onTogglePin,
  }: {
    value: string
    onSelect: () => void
    name: string
    folderPath?: string[]
    isCurrent?: boolean
  } & ResultAdornmentProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <div className='relative flex size-[16px] flex-shrink-0 items-center justify-center'>
          <Workflow className='size-[14px] text-[var(--text-icon)]' />
        </div>
        <span className='flex min-w-0 max-w-[75%] flex-shrink-0 text-[var(--text-body)]'>
          <span className='truncate'>{name}</span>
          {isCurrent && <span className='flex-shrink-0 whitespace-pre'> (current)</span>}
        </span>
        {meta ? (
          <ItemMeta meta={meta} />
        ) : folderPath && folderPath.length > 0 ? (
          <span className='ml-auto flex min-w-0 pl-2 text-[var(--text-subtle)] text-small'>
            {folderPath.length > 1 && (
              <>
                <span className='min-w-0 truncate [flex-shrink:9999]'>
                  {folderPath.slice(0, -1).join(' / ')}
                </span>
                <span className='flex-shrink-0 whitespace-pre'> / </span>
              </>
            )}
            <span className='min-w-0 truncate'>{folderPath[folderPath.length - 1]}</span>
          </span>
        ) : null}
        {onTogglePin && (
          <PinButton
            pinned={pinned}
            onTogglePin={onTogglePin}
            hasOtherRightContent={Boolean(meta || folderPath?.length)}
          />
        )}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.name === next.name &&
    prev.isCurrent === next.isCurrent &&
    prev.meta === next.meta &&
    prev.pinned === next.pinned &&
    (prev.folderPath === next.folderPath ||
      (prev.folderPath?.length === next.folderPath?.length &&
        (prev.folderPath ?? []).every((segment, i) => segment === next.folderPath?.[i])))
)

export const MemoizedFileItem = memo(
  function FileItem({
    value,
    onSelect,
    name,
    folderPath,
    meta,
    pinned,
    onTogglePin,
  }: {
    value: string
    onSelect: () => void
    name: string
    folderPath?: string[]
  } & ResultAdornmentProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <div className='relative flex size-[16px] flex-shrink-0 items-center justify-center'>
          <File className='size-[14px] text-[var(--text-icon)]' />
        </div>
        <span className='flex min-w-0 max-w-[75%] flex-shrink-0 font-base text-[var(--text-body)]'>
          <span className='truncate'>{name}</span>
        </span>
        {meta ? (
          <ItemMeta meta={meta} />
        ) : folderPath && folderPath.length > 0 ? (
          <span className='ml-auto flex min-w-0 pl-2 font-base text-[var(--text-subtle)] text-small'>
            {folderPath.length > 1 && (
              <>
                <span className='min-w-0 truncate [flex-shrink:9999]'>
                  {folderPath.slice(0, -1).join(' / ')}
                </span>
                <span className='flex-shrink-0 whitespace-pre'> / </span>
              </>
            )}
            <span className='min-w-0 truncate'>{folderPath[folderPath.length - 1]}</span>
          </span>
        ) : null}
        {onTogglePin && (
          <PinButton
            pinned={pinned}
            onTogglePin={onTogglePin}
            hasOtherRightContent={Boolean(meta || folderPath?.length)}
          />
        )}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.name === next.name &&
    prev.meta === next.meta &&
    prev.pinned === next.pinned &&
    (prev.folderPath === next.folderPath ||
      (prev.folderPath?.length === next.folderPath?.length &&
        (prev.folderPath ?? []).every((segment, i) => segment === next.folderPath?.[i])))
)

export const MemoizedTaskItem = memo(
  function TaskItem({
    value,
    onSelect,
    name,
    meta,
    pinned,
    onTogglePin,
  }: {
    value: string
    onSelect: () => void
    name: string
  } & ResultAdornmentProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <span className='truncate text-[var(--text-body)]'>{name}</span>
        {meta && <ItemMeta meta={meta} />}
        {onTogglePin && (
          <PinButton
            pinned={pinned}
            onTogglePin={onTogglePin}
            hasOtherRightContent={Boolean(meta)}
          />
        )}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.name === next.name &&
    prev.meta === next.meta &&
    prev.pinned === next.pinned
)

export const MemoizedWorkspaceItem = memo(
  function WorkspaceItem({
    value,
    onSelect,
    name,
    isCurrent,
    meta,
    pinned,
    onTogglePin,
  }: {
    value: string
    onSelect: () => void
    name: string
    isCurrent?: boolean
  } & ResultAdornmentProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <span className='flex min-w-0 text-[var(--text-body)]'>
          <span className='truncate'>{name}</span>
          {isCurrent && <span className='flex-shrink-0 whitespace-pre'> (current)</span>}
        </span>
        {meta && <ItemMeta meta={meta} />}
        {onTogglePin && (
          <PinButton
            pinned={pinned}
            onTogglePin={onTogglePin}
            hasOtherRightContent={Boolean(meta)}
          />
        )}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.name === next.name &&
    prev.isCurrent === next.isCurrent &&
    prev.meta === next.meta &&
    prev.pinned === next.pinned
)

export const MemoizedPageItem = memo(
  function PageItem({
    value,
    onSelect,
    icon: Icon,
    name,
    shortcut,
    meta,
    pinned,
    onTogglePin,
  }: {
    value: string
    onSelect: () => void
    icon: ComponentType<{ className?: string }>
    name: string
    shortcut?: string
  } & ResultAdornmentProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <Icon className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
        <span className='truncate text-[var(--text-body)]'>{name}</span>
        {meta ? (
          <ItemMeta meta={meta} />
        ) : shortcut ? (
          <span className='ml-auto flex-shrink-0 text-[var(--text-subtle)] text-small'>
            {shortcut}
          </span>
        ) : null}
        {onTogglePin && (
          <PinButton
            pinned={pinned}
            onTogglePin={onTogglePin}
            hasOtherRightContent={Boolean(meta || shortcut)}
          />
        )}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.icon === next.icon &&
    prev.name === next.name &&
    prev.shortcut === next.shortcut &&
    prev.meta === next.meta &&
    prev.pinned === next.pinned
)

export const MemoizedIconItem = memo(
  function IconItem({
    value,
    onSelect,
    name,
    icon: Icon,
    meta,
    pinned,
    onTogglePin,
  }: {
    value: string
    onSelect: () => void
    name: string
    icon: ComponentType<{ className?: string }>
  } & ResultAdornmentProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <Icon className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
        <span className='truncate text-[var(--text-body)]'>{name}</span>
        {meta && <ItemMeta meta={meta} />}
        {onTogglePin && (
          <PinButton
            pinned={pinned}
            onTogglePin={onTogglePin}
            hasOtherRightContent={Boolean(meta)}
          />
        )}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.name === next.name &&
    prev.icon === next.icon &&
    prev.meta === next.meta &&
    prev.pinned === next.pinned
)
