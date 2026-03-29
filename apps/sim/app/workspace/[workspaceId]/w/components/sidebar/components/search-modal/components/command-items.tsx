'use client'

import type { ComponentType } from 'react'
import { memo } from 'react'
import { Command } from 'cmdk'
import { Blimp } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { CommandItemProps } from '../utils'
import { COMMAND_ITEM_CLASSNAME } from '../utils'

export const MemoizedCommandItem = memo(
  function CommandItem({
    value,
    onSelect,
    icon: Icon,
    bgColor,
    showColoredIcon,
    children,
  }: CommandItemProps) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <div
          className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-sm'
          style={{ background: showColoredIcon ? bgColor : 'transparent' }}
        >
          <Icon
            className={cn(
              'transition-transform duration-100 group-hover:scale-110',
              showColoredIcon
                ? '!h-[10px] !w-[10px] text-white'
                : 'h-[14px] w-[14px] text-[var(--text-icon)]'
            )}
          />
        </div>
        <span className='truncate font-base text-[var(--text-body)]'>{children}</span>
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.icon === next.icon &&
    prev.bgColor === next.bgColor &&
    prev.showColoredIcon === next.showColoredIcon &&
    prev.children === next.children
)

export const MemoizedWorkflowItem = memo(
  function WorkflowItem({
    value,
    onSelect,
    color,
    name,
    isCurrent,
  }: {
    value: string
    onSelect: () => void
    color: string
    name: string
    isCurrent?: boolean
  }) {
    return (
      <Command.Item value={value} onSelect={onSelect} className={COMMAND_ITEM_CLASSNAME}>
        <div
          className='h-[14px] w-[14px] flex-shrink-0 rounded-sm border-[2px]'
          style={{
            backgroundColor: color,
            borderColor: `${color}60`,
            backgroundClip: 'padding-box',
          }}
        />
        <span className='truncate font-base text-[var(--text-body)]'>
          {name}
          {isCurrent && ' (current)'}
        </span>
      </Command.Item>
    )
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.color === next.color &&
    prev.name === next.name &&
    prev.isCurrent === next.isCurrent
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
        <div className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
          <Blimp className='h-[14px] w-[14px] text-[var(--text-icon)]' />
        </div>
        <span className='truncate font-base text-[var(--text-body)]'>{name}</span>
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
        <span className='truncate font-base text-[var(--text-body)]'>
          {name}
          {isCurrent && ' (current)'}
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
        <div className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
          <Icon className='h-[14px] w-[14px] text-[var(--text-icon)]' />
        </div>
        <span className='truncate font-base text-[var(--text-body)]'>{name}</span>
        {shortcut && (
          <span className='ml-auto flex-shrink-0 font-base text-[var(--text-subtle)] text-small'>
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
        <div className='relative flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
          <Icon className='h-[14px] w-[14px] text-[var(--text-icon)]' />
        </div>
        <span className='truncate font-base text-[var(--text-body)]'>{name}</span>
      </Command.Item>
    )
  },
  (prev, next) => prev.value === next.value && prev.name === next.name && prev.icon === next.icon
)
