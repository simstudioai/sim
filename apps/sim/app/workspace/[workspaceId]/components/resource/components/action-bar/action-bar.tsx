'use client'

import type { ComponentType } from 'react'
import {
  Button,
  chipFilledFillTokens,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Folder,
  Tooltip,
  Trash,
} from '@sim/emcn'
import { Download } from '@sim/emcn/icons'
import type { MoveOptionNode } from '@/app/workspace/[workspaceId]/components/folders'
import { renderMoveOption } from '@/app/workspace/[workspaceId]/components/folders'

/** Shared chrome for every action button, so the bar reads as one control strip. */
const ACTION_BUTTON_CLASS = cn(
  chipFilledFillTokens,
  'hover-hover:!text-[var(--text-inverse)] size-[28px] rounded-lg p-0 text-[var(--text-secondary)] hover-hover:bg-[var(--brand-secondary)]'
)

interface ActionButtonProps {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  disabled?: boolean
}

function ActionButton({ icon: Icon, label, onClick, disabled }: ActionButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant='ghost'
          onClick={onClick}
          disabled={disabled}
          className={ACTION_BUTTON_CLASS}
        >
          <Icon className='size-[12px]' />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content side='top'>{label}</Tooltip.Content>
    </Tooltip.Root>
  )
}

export interface ResourceActionBarProps {
  /** The bar is mounted only while this is above zero; it animates in and out on the edges. */
  selectedCount: number
  /** Omit on lists with nothing to download (tables, knowledge bases). */
  onDownload?: () => void
  /** Both `onMove` and `moveOptions` are required for the move menu to appear. */
  onMove?: (optionValue: string) => void
  moveOptions?: MoveOptionNode[]
  onDelete?: () => void
  /** Disables every action while a bulk mutation is in flight. */
  isLoading?: boolean
  className?: string
}

/**
 * Floating bulk-action bar for a `Resource.Table` with checkbox selection, shared so Files,
 * Tables, and Knowledge present the same strip in the same place.
 *
 * Actions are ordered to mirror the row context menu — move before delete, destructive last.
 * Each action is opt-in: a list that cannot perform one simply omits its handler, and a reader
 * omits the ones they lack permission for.
 *
 * The entrance is a CSS animation rather than framer-motion: this bar is reachable from three
 * list pages, and an animation library on that path costs every one of them ~40 modules of page
 * weight for one fade. The trade is that dismissal is instant — an exit animation needs presence
 * tracking, which is the part that pulls the library back in.
 */
export function ResourceActionBar({
  selectedCount,
  onDownload,
  onMove,
  moveOptions,
  onDelete,
  isLoading = false,
  className,
}: ResourceActionBarProps) {
  if (selectedCount === 0) return null

  return (
    <div
      className={cn(
        '-translate-x-1/2 fixed bottom-6 left-1/2 z-[var(--z-dropdown)] transform',
        'fade-in-0 slide-in-from-bottom-2 animate-in duration-200 ease-out motion-reduce:animate-none',
        className
      )}
    >
      <div className='flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5'>
        <span className='px-1 text-[var(--text-secondary)] text-small'>
          {selectedCount} selected
        </span>
        <div className='flex items-center gap-[5px]'>
          {onDownload && (
            <ActionButton
              icon={Download}
              label='Download'
              onClick={onDownload}
              disabled={isLoading}
            />
          )}
          {onMove && moveOptions && (
            <DropdownMenu>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant='ghost' disabled={isLoading} className={ACTION_BUTTON_CLASS}>
                      <Folder className='size-[12px]' />
                    </Button>
                  </DropdownMenuTrigger>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>Move</Tooltip.Content>
              </Tooltip.Root>
              <DropdownMenuContent
                side='top'
                align='center'
                className='max-h-[240px] overflow-y-auto'
              >
                {moveOptions.length > 0 && (
                  <DropdownMenuItem onSelect={() => onMove(moveOptions[0].value)}>
                    <Folder />
                    {moveOptions[0].label}
                  </DropdownMenuItem>
                )}
                {moveOptions.length > 1 && <DropdownMenuSeparator />}
                {moveOptions.slice(1).map((option) => renderMoveOption(option, onMove))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {onDelete && (
            <ActionButton icon={Trash} label='Delete' onClick={onDelete} disabled={isLoading} />
          )}
        </div>
      </div>
    </div>
  )
}
