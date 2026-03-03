'use client'

import { memo } from 'react'
import { useTranslations } from 'next-intl'
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
import { getBlockIcon } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/utils'

/**
 * Props for the FilterPopover component
 */
export interface FilterPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: TerminalFilters
  toggleStatus: (status: 'error' | 'info') => void
  toggleBlock: (blockId: string) => void
  uniqueBlocks: BlockInfo[]
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
  uniqueBlocks,
  hasActiveFilters,
}: FilterPopoverProps) {
  const t = useTranslations()

  return (
    <Popover open={open} onOpenChange={onOpenChange} size='sm'>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          className='!p-1.5 -m-1.5'
          onClick={(e) => e.stopPropagation()}
          aria-label={t('terminal.filter_popover.aria_label')}
        >
          <Filter
            className={clsx('h-3 w-3', hasActiveFilters && 'text-[var(--brand-secondary)]')}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side='top'
        align='end'
        sideOffset={4}
        onClick={(e) => e.stopPropagation()}
        minWidth={160}
        maxWidth={220}
        maxHeight={300}
      >
        <PopoverSection>{t('terminal.filter_popover.status_section')}</PopoverSection>
        <PopoverItem
          active={filters.statuses.has('error')}
          showCheck={filters.statuses.has('error')}
          onClick={() => toggleStatus('error')}
        >
          <div
            className='h-[6px] w-[6px] rounded-[2px]'
            style={{ backgroundColor: 'var(--text-error)' }}
          />
          <span className='flex-1'>{t('terminal.filter_popover.error_status')}</span>
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
          <span className='flex-1'>{t('terminal.filter_popover.info_status')}</span>
        </PopoverItem>

        {uniqueBlocks.length > 0 && (
          <>
            <PopoverDivider className='my-[4px]' />
            <PopoverSection className='!mt-0'>
              {t('terminal.filter_popover.blocks_section')}
            </PopoverSection>
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
      </PopoverContent>
    </Popover>
  )
})
