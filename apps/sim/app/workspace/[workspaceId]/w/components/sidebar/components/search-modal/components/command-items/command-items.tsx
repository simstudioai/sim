'use client'

import type { ComponentType } from 'react'
import { memo } from 'react'
import { OverflowText } from '@sim/emcn'
import { File, Workflow } from '@sim/emcn/icons'
import { Command } from 'cmdk'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { getWorkspaceInitial } from '@/lib/workspaces/initials'
import type { CommandItemProps } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import { COMMAND_ITEM_CLASSNAME } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import { BlockTile } from '@/blocks/block-tile'

interface ResultMetaProps {
  meta?: string
}

interface ItemMetaProps {
  meta: string
}

function ItemMeta({ meta }: ItemMetaProps) {
  return <span className='ml-auto shrink-0 pl-2 text-[var(--text-subtle)] text-small'>{meta}</span>
}

interface ItemFolderPathProps {
  folderPath: string[]
}

/** Trailing folder-path receipt whose head segments yield space to the leaf. */
function ItemFolderPath({ folderPath }: ItemFolderPathProps) {
  return (
    <span className='ml-auto flex min-w-0 pl-2 text-[var(--text-subtle)] text-small'>
      {folderPath.length > 1 && (
        <>
          <OverflowText
            label={folderPath.slice(0, -1).join(' / ')}
            className='[flex-shrink:9999]'
          />
          <span className='shrink-0 whitespace-pre'> / </span>
        </>
      )}
      <OverflowText label={folderPath[folderPath.length - 1]} />
    </span>
  )
}

/** Structural equality for the optional folder-path prop in memo comparators. */
function sameFolderPath(prev?: string[], next?: string[]): boolean {
  return (
    prev === next ||
    (prev?.length === next?.length && (prev ?? []).every((segment, i) => segment === next?.[i]))
  )
}

interface ShortcutHintProps {
  shortcut: string
}

function ShortcutHint({ shortcut }: ShortcutHintProps) {
  const commandIndex = shortcut.indexOf('⌘')
  const slots =
    commandIndex === -1
      ? ['', '', shortcut]
      : [shortcut.slice(0, commandIndex), '⌘', shortcut.slice(commandIndex + 1)]

  return (
    <span
      aria-label={`Keyboard shortcut ${shortcut}`}
      className='ml-auto grid w-10 shrink-0 grid-cols-3 text-center text-[var(--text-subtle)] text-small'
    >
      {slots.map((slot, index) => (
        <span key={`${index}-${slot}`} aria-hidden='true'>
          {slot}
        </span>
      ))}
    </span>
  )
}

export const MemoizedCommandItem = memo(
  function CommandItem({
    value,
    onSelect,
    icon: Icon,
    bgColor,
    blockType,
    label,
    labelPrefix,
    meta,
  }: CommandItemProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <BlockTile blockType={blockType} icon={Icon} bgColor={bgColor} />
        <OverflowText
          label={`${labelPrefix ? `${labelPrefix} ` : ''}${label}`}
          className='text-[var(--text-body)]'
        >
          {labelPrefix && <span className='text-[var(--text-subtle)]'>{labelPrefix} </span>}
          {label}
        </OverflowText>
        {meta ? <ItemMeta meta={meta} /> : null}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.icon === next.icon &&
    prev.bgColor === next.bgColor &&
    prev.blockType === next.blockType &&
    prev.label === next.label &&
    prev.labelPrefix === next.labelPrefix &&
    prev.meta === next.meta
)

export const MemoizedActionItem = memo(
  function ActionItem({
    value,
    onSelect,
    icon: Icon,
    name,
    shortcut,
    meta,
  }: {
    value: string
    onSelect: () => void
    icon: ComponentType<{ className?: string }>
    name: string
    shortcut?: string
  } & ResultMetaProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <Icon className='size-[16px] shrink-0 text-[var(--text-icon)]' />
        <OverflowText label={name} className='text-[var(--text-body)]' />
        {meta ? <ItemMeta meta={meta} /> : shortcut ? <ShortcutHint shortcut={shortcut} /> : null}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.icon === next.icon &&
    prev.name === next.name &&
    prev.shortcut === next.shortcut &&
    prev.meta === next.meta
)

export const MemoizedWorkflowItem = memo(
  function WorkflowItem({
    value,
    onSelect,
    name,
    folderPath,
    isCurrent,
    meta,
  }: {
    value: string
    onSelect: () => void
    name: string
    folderPath?: string[]
    isCurrent?: boolean
  } & ResultMetaProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <div className='relative flex size-[16px] shrink-0 items-center justify-center'>
          <Workflow className='size-[14px] text-[var(--text-icon)]' />
        </div>
        <span className='flex min-w-0 max-w-[75%] shrink-0 text-[var(--text-body)]'>
          <OverflowText label={name} />
          {isCurrent && <span className='shrink-0 whitespace-pre'> (current)</span>}
        </span>
        {meta ? (
          <ItemMeta meta={meta} />
        ) : folderPath && folderPath.length > 0 ? (
          <ItemFolderPath folderPath={folderPath} />
        ) : null}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.name === next.name &&
    prev.isCurrent === next.isCurrent &&
    prev.meta === next.meta &&
    sameFolderPath(prev.folderPath, next.folderPath)
)

export const MemoizedFileItem = memo(
  function FileItem({
    value,
    onSelect,
    name,
    folderPath,
    meta,
  }: {
    value: string
    onSelect: () => void
    name: string
    folderPath?: string[]
  } & ResultMetaProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <div className='relative flex size-[16px] shrink-0 items-center justify-center'>
          <File className='size-[14px] text-[var(--text-icon)]' />
        </div>
        <span className='flex min-w-0 max-w-[75%] shrink-0 text-[var(--text-body)]'>
          <OverflowText label={name} />
        </span>
        {meta ? (
          <ItemMeta meta={meta} />
        ) : folderPath && folderPath.length > 0 ? (
          <ItemFolderPath folderPath={folderPath} />
        ) : null}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.name === next.name &&
    prev.meta === next.meta &&
    sameFolderPath(prev.folderPath, next.folderPath)
)

export const MemoizedTaskItem = memo(
  function TaskItem({
    value,
    onSelect,
    name,
    meta,
  }: {
    value: string
    onSelect: () => void
    name: string
  } & ResultMetaProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <OverflowText label={name} className='text-[var(--text-body)]' />
        {meta && <ItemMeta meta={meta} />}
      </Command.Item>
    )
  },
  (prev, next) => prev.value === next.value && prev.name === next.name && prev.meta === next.meta
)

export const MemoizedWorkspaceItem = memo(
  function WorkspaceItem({
    value,
    onSelect,
    name,
    isCurrent,
    logoUrl,
    meta,
  }: {
    value: string
    onSelect: () => void
    name: string
    isCurrent?: boolean
    logoUrl?: string | null
  } & ResultMetaProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <IdentityTile initial={getWorkspaceInitial(name)} logoUrl={logoUrl} slot='workspace-icon' />
        <span className='flex min-w-0 text-[var(--text-body)]'>
          <OverflowText label={name} />
          {isCurrent && <span className='shrink-0 whitespace-pre'> (current)</span>}
        </span>
        {meta && <ItemMeta meta={meta} />}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.name === next.name &&
    prev.isCurrent === next.isCurrent &&
    prev.logoUrl === next.logoUrl &&
    prev.meta === next.meta
)

export const MemoizedPageItem = memo(
  function PageItem({
    value,
    onSelect,
    icon: Icon,
    name,
    shortcut,
    meta,
  }: {
    value: string
    onSelect: () => void
    icon: ComponentType<{ className?: string }>
    name: string
    shortcut?: string
  } & ResultMetaProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <Icon className='size-[16px] shrink-0 text-[var(--text-icon)]' />
        <OverflowText label={name} className='text-[var(--text-body)]' />
        {meta ? <ItemMeta meta={meta} /> : shortcut ? <ShortcutHint shortcut={shortcut} /> : null}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.icon === next.icon &&
    prev.name === next.name &&
    prev.shortcut === next.shortcut &&
    prev.meta === next.meta
)

export const MemoizedIconItem = memo(
  function IconItem({
    value,
    onSelect,
    name,
    icon: Icon,
    folderPath,
    meta,
  }: {
    value: string
    onSelect: () => void
    name: string
    icon: ComponentType<{ className?: string }>
    folderPath?: string[]
  } & ResultMetaProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <Icon className='size-[16px] shrink-0 text-[var(--text-icon)]' />
        <span className='flex min-w-0 max-w-[75%] shrink-0 text-[var(--text-body)]'>
          <OverflowText label={name} />
        </span>
        {meta ? (
          <ItemMeta meta={meta} />
        ) : folderPath && folderPath.length > 0 ? (
          <ItemFolderPath folderPath={folderPath} />
        ) : null}
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.name === next.name &&
    prev.icon === next.icon &&
    prev.meta === next.meta &&
    sameFolderPath(prev.folderPath, next.folderPath)
)
