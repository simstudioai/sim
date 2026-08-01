'use client'

import type { ComponentType } from 'react'
import { memo } from 'react'
import { cn } from '@sim/emcn'
import { File, Workflow } from '@sim/emcn/icons'
import { Command } from 'cmdk'
import type { CommandItemProps } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import { COMMAND_ITEM_CLASSNAME } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import { getTileIconColorClass } from '@/blocks/icon-color'

export const MemoizedCommandItem = memo(
  function CommandItem({
    value,
    onSelect,
    icon: Icon,
    bgColor,
    showColoredIcon,
    label,
  }: CommandItemProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
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
        <span className='truncate text-[var(--text-body)]'>{label}</span>
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.icon === next.icon &&
    prev.bgColor === next.bgColor &&
    prev.showColoredIcon === next.showColoredIcon &&
    prev.label === next.label
)

export const MemoizedActionItem = memo(
  function ActionItem({
    value,
    onSelect,
    icon: Icon,
    name,
    shortcut,
  }: {
    value: string
    onSelect: () => void
    icon: ComponentType<{ className?: string }>
    name: string
    shortcut?: string
  }) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <Icon className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
        <span className='truncate text-[var(--text-body)]'>{name}</span>
        {shortcut && (
          <span className='ml-auto flex-shrink-0 text-[var(--text-subtle)] text-small'>
            {shortcut}
          </span>
        )}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.icon === next.icon &&
    prev.name === next.name &&
    prev.shortcut === next.shortcut
)

export const MemoizedWorkflowItem = memo(
  function WorkflowItem({
    value,
    onSelect,
    name,
    folderPath,
    isCurrent,
  }: {
    value: string
    onSelect: () => void
    name: string
    folderPath?: string[]
    isCurrent?: boolean
  }) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <div className='relative flex size-[16px] flex-shrink-0 items-center justify-center'>
          <Workflow className='size-[14px] text-[var(--text-icon)]' />
        </div>
        <span className='flex min-w-0 max-w-[75%] flex-shrink-0 text-[var(--text-body)]'>
          <span className='truncate'>{name}</span>
          {isCurrent && <span className='flex-shrink-0 whitespace-pre'> (current)</span>}
        </span>
        {folderPath && folderPath.length > 0 && (
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
        )}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.name === next.name &&
    prev.isCurrent === next.isCurrent &&
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
  }: {
    value: string
    onSelect: () => void
    name: string
    folderPath?: string[]
  }) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <div className='relative flex size-[16px] flex-shrink-0 items-center justify-center'>
          <File className='size-[14px] text-[var(--text-icon)]' />
        </div>
        <span className='flex min-w-0 max-w-[75%] flex-shrink-0 font-base text-[var(--text-body)]'>
          <span className='truncate'>{name}</span>
        </span>
        {folderPath && folderPath.length > 0 && (
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
        )}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.name === next.name &&
    (prev.folderPath === next.folderPath ||
      (prev.folderPath?.length === next.folderPath?.length &&
        (prev.folderPath ?? []).every((segment, i) => segment === next.folderPath?.[i])))
)

export const MemoizedTaskItem = memo(
  function TaskItem({
    value,
    onSelect,
    name,
  }: {
    value: string
    onSelect: () => void
    name: string
  }) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <span className='truncate text-[var(--text-body)]'>{name}</span>
      </Command.Item>
    )
  },
  (prev, next) => prev.value === next.value && prev.name === next.name
)

export const MemoizedWorkspaceItem = memo(
  function WorkspaceItem({
    value,
    onSelect,
    name,
    isCurrent,
  }: {
    value: string
    onSelect: () => void
    name: string
    isCurrent?: boolean
  }) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <span className='flex min-w-0 text-[var(--text-body)]'>
          <span className='truncate'>{name}</span>
          {isCurrent && <span className='flex-shrink-0 whitespace-pre'> (current)</span>}
        </span>
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value && prev.name === next.name && prev.isCurrent === next.isCurrent
)

export const MemoizedPageItem = memo(
  function PageItem({
    value,
    onSelect,
    icon: Icon,
    name,
    shortcut,
  }: {
    value: string
    onSelect: () => void
    icon: ComponentType<{ className?: string }>
    name: string
    shortcut?: string
  }) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <Icon className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
        <span className='truncate text-[var(--text-body)]'>{name}</span>
        {shortcut && (
          <span className='ml-auto flex-shrink-0 text-[var(--text-subtle)] text-small'>
            {shortcut}
          </span>
        )}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.icon === next.icon &&
    prev.name === next.name &&
    prev.shortcut === next.shortcut
)

export const MemoizedIconItem = memo(
  function IconItem({
    value,
    onSelect,
    name,
    icon: Icon,
  }: {
    value: string
    onSelect: () => void
    name: string
    icon: ComponentType<{ className?: string }>
  }) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <Icon className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
        <span className='truncate text-[var(--text-body)]'>{name}</span>
      </Command.Item>
    )
  },
  (prev, next) => prev.value === next.value && prev.name === next.name && prev.icon === next.icon
)
