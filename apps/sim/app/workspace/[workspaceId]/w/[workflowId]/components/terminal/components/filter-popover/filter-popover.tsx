'use client'

import { memo } from 'react'
import clsx from 'clsx'
import { Filter } from 'lucide-react'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
  PopoverScrollArea,
  PopoverSection,
  PopoverTrigger,
} from '@/components/emcn'
import type {
  BlockInfo,
  TerminalFilters,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/types'
import {
  formatRunId,
  getBlockIcon,
  getRunIdColor,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/utils'

/**
 * Props for the FilterPopover component
 */
export interface FilterPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: TerminalFilters
  toggleStatus: (status: 'error' | 'info') => void
  toggleBlock: (blockId: string) => void
  toggleRunId: (runId: string) => void
  uniqueBlocks: BlockInfo[]
  uniqueRunIds: string[]
  executionColorMap: Map<string, string>
  hasActiveFilters: boolean
}

/**
 * Filter popover component used in terminal header and output panel
 */
export const FilterPopover = memo(function FilterPopover({
  open,
  onOpenChange,
  filters,
  toggleStatus,
  toggleBlock,
  toggleRunId,
  uniqueBlocks,
  uniqueRunIds,
  executionColorMap,
  hasActiveFilters,
}: FilterPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} size='sm'>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          className='!p-1.5 -m-1.5'
          onClick={(e) => e.stopPropagation()}
          aria-label='Filters'
        >
          <Filter
            className={clsx('h-3 w-3', hasActiveFilters && 'text-[var(--brand-secondary)]')}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side='bottom'
        align='end'
        sideOffset={4}
        onClick={(e) => e.stopPropagation()}
        minWidth={160}
        maxWidth={220}
        maxHeight={300}
      >
        <PopoverSection>Status</PopoverSection>
        <PopoverItem
          active={filters.statuses.has('error')}
          showCheck={filters.statuses.has('error')}
          onClick={() => toggleStatus('error')}
        >
          <div
            className='h-[6px] w-[6px] rounded-[2px]'
            style={{ backgroundColor: 'var(--text-error)' }}
          />
          <span className='flex-1'>Error</span>
        </PopoverItem>
        <PopoverItem
          active={filters.statuses.has('info')}
          showCheck={filters.statuses.has('info')}
          onClick={() => toggleStatus('info')}
        >
          <div
            className='h-[6px] w-[6px] rounded-[2px]'
            style={{ backgroundColor: 'var(--terminal-status-info-color)' }}
          />
          <span className='flex-1'>Info</span>
        </PopoverItem>

        {uniqueBlocks.length > 0 && (
          <>
            <PopoverDivider />
            <PopoverSection className='!mt-0'>Blocks</PopoverSection>
            <PopoverScrollArea className='max-h-[100px]'>
              {uniqueBlocks.map((block) => {
                const BlockIcon = getBlockIcon(block.blockType)
                const isSelected = filters.blockIds.has(block.blockId)

                return (
                  <PopoverItem
                    key={block.blockId}
                    active={isSelected}
                    showCheck={isSelected}
                    onClick={() => toggleBlock(block.blockId)}
                  >
                    {BlockIcon && <BlockIcon className='h-3 w-3' />}
                    <span className='flex-1'>{block.blockName}</span>
                  </PopoverItem>
                )
              })}
            </PopoverScrollArea>
          </>
        )}

        {uniqueRunIds.length > 0 && (
          <>
            <PopoverDivider />
            <PopoverSection className='!mt-0'>Run ID</PopoverSection>
            <PopoverScrollArea className='max-h-[100px]'>
              {uniqueRunIds.map((runId) => {
                const isSelected = filters.runIds.has(runId)
                const runIdColor = getRunIdColor(runId, executionColorMap)

                return (
                  <PopoverItem
                    key={runId}
                    active={isSelected}
                    showCheck={isSelected}
                    onClick={() => toggleRunId(runId)}
                  >
                    <span
                      className='flex-1 font-mono text-[11px]'
                      style={{ color: runIdColor || '#D2D2D2' }}
                    >
                      {formatRunId(runId)}
                    </span>
                  </PopoverItem>
                )
              })}
            </PopoverScrollArea>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
})
