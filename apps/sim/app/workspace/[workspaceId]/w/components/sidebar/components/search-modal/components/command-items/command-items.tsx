'use client'

import type { ComponentType } from 'react'
import { memo } from 'react'
import { Command } from 'cmdk'
import { File, Workflow } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import type { CommandItemProps } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import {
  COMMAND_ITEM_CLASSNAME,
  fuzzyMatch,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/utils'
import { useTranslations } from 'next-intl'

interface Segment {
  text: string
  hit: boolean
}

function buildSegments(text: string, positions: readonly number[]): Segment[] {
  const hits = new Set(positions)
  const segments: Segment[] = []
  for (let i = 0; i < text.length; i++) {
    const hit = hits.has(i)
    const last = segments[segments.length - 1]
    if (last && last.hit === hit) last.text += text[i]
    else segments.push({ text: text[i], hit })
  }
  return segments
}

/**
 * Renders `text` with the characters that match `query` emphasized. Falls back
 * to plain text when there is no query or no positional match against the
 * display text (e.g. the row matched on a hidden id rather than its label).
 */
export const HighlightedText = memo(
  function HighlightedText({ text, query }: { text: string; query?: string }) {
    if (!query) return <>{text}</>
    const { positions } = fuzzyMatch(text, query)
    if (positions.length === 0) return <>{text}</>
    return (
      <>
        {buildSegments(text, positions).map((segment, index) =>
          segment.hit ? (
            <span key={index} className='font-medium'>
              {segment.text}
            </span>
          ) : (
            <span key={index}>{segment.text}</span>
          )
        )}
      </>
    )
  },
  (prev, next) => prev.text === next.text && prev.query === next.query
)

export const MemoizedCommandItem = memo(
  function CommandItem({
    value,
    onSelect,
    icon: Icon,
    bgColor,
    showColoredIcon,
    label,
    query,
  }: CommandItemProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <div
          className='relative flex size-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-sm'
          style={{ background: showColoredIcon ? bgColor : 'transparent' }}
        >
          <Icon
            className={cn(
              'transition-transform duration-100 group-hover:scale-110',
              showColoredIcon
                ? '!h-[10px] !w-[10px] text-white'
                : 'size-[16px] text-[var(--text-icon)]'
            )}
          />
        </div>
        <span className='truncate text-[var(--text-body)]'>
          <HighlightedText text={label} query={query} />
        </span>
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.icon === next.icon &&
    prev.bgColor === next.bgColor &&
    prev.showColoredIcon === next.showColoredIcon &&
    prev.label === next.label &&
    prev.query === next.query
)

export const MemoizedActionItem = memo(
  function ActionItem({
    value,
    onSelect,
    icon: Icon,
    name,
    shortcut,
    query,
  }: {
    value: string
    onSelect: () => void
    icon: ComponentType<{ className?: string }>
    name: string
    shortcut?: string
    query?: string
  }) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <Icon className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
        <span className='truncate text-[var(--text-body)]'>
          <HighlightedText text={name} query={query} />
        </span>
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
    prev.shortcut === next.shortcut &&
    prev.query === next.query
)

export const MemoizedWorkflowItem = memo(
  function WorkflowItem({
    value,
    onSelect,
    name,
    folderPath,
    isCurrent,
    query,
  }: {
    value: string
    onSelect: () => void
    name: string
    folderPath?: string[]
    isCurrent?: boolean
    query?: string
  }) {
  const t = useTranslations('auto')
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <div className='relative flex size-[16px] flex-shrink-0 items-center justify-center'>
          <Workflow className='size-[14px] text-[var(--text-icon)]' />
        </div>
        <span className='flex min-w-0 max-w-[75%] flex-shrink-0 text-[var(--text-body)]'>
          <span className='truncate'>
            <HighlightedText text={name} query={query} />
          </span>
          {isCurrent && <span className='flex-shrink-0 whitespace-pre'> {t('current')}</span>}
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
    prev.query === next.query &&
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
    query,
  }: {
    value: string
    onSelect: () => void
    name: string
    folderPath?: string[]
    query?: string
  }) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <div className='relative flex size-[16px] flex-shrink-0 items-center justify-center'>
          <File className='size-[14px] text-[var(--text-icon)]' />
        </div>
        <span className='flex min-w-0 max-w-[75%] flex-shrink-0 font-base text-[var(--text-body)]'>
          <span className='truncate'>
            <HighlightedText text={name} query={query} />
          </span>
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
    prev.query === next.query &&
    (prev.folderPath === next.folderPath ||
      (prev.folderPath?.length === next.folderPath?.length &&
        (prev.folderPath ?? []).every((segment, i) => segment === next.folderPath?.[i])))
)

export const MemoizedTaskItem = memo(
  function TaskItem({
    value,
    onSelect,
    name,
    query,
  }: {
    value: string
    onSelect: () => void
    name: string
    query?: string
  }) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <span className='truncate text-[var(--text-body)]'>
          <HighlightedText text={name} query={query} />
        </span>
      </Command.Item>
    )
  },
  (prev, next) => prev.value === next.value && prev.name === next.name && prev.query === next.query
)

export const MemoizedWorkspaceItem = memo(
  function WorkspaceItem({
    value,
    onSelect,
    name,
    isCurrent,
    query,
  }: {
    value: string
    onSelect: () => void
    name: string
    isCurrent?: boolean
    query?: string
  }) {
  const t = useTranslations('auto')
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <span className='flex min-w-0 text-[var(--text-body)]'>
          <span className='truncate'>
            <HighlightedText text={name} query={query} />
          </span>
          {isCurrent && <span className='flex-shrink-0 whitespace-pre'> {t('current')}</span>}
        </span>
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.name === next.name &&
    prev.isCurrent === next.isCurrent &&
    prev.query === next.query
)

export const MemoizedPageItem = memo(
  function PageItem({
    value,
    onSelect,
    icon: Icon,
    name,
    shortcut,
    query,
  }: {
    value: string
    onSelect: () => void
    icon: ComponentType<{ className?: string }>
    name: string
    shortcut?: string
    query?: string
  }) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <Icon className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
        <span className='truncate text-[var(--text-body)]'>
          <HighlightedText text={name} query={query} />
        </span>
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
    prev.shortcut === next.shortcut &&
    prev.query === next.query
)

export const MemoizedIconItem = memo(
  function IconItem({
    value,
    onSelect,
    name,
    icon: Icon,
    query,
  }: {
    value: string
    onSelect: () => void
    name: string
    icon: ComponentType<{ className?: string }>
    query?: string
  }) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <Icon className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
        <span className='truncate text-[var(--text-body)]'>
          <HighlightedText text={name} query={query} />
        </span>
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.name === next.name &&
    prev.icon === next.icon &&
    prev.query === next.query
)
