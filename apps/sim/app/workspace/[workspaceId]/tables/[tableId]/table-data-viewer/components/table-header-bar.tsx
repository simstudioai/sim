/**
 * Header bar for the table data viewer.
 */

import { Info, RefreshCw } from 'lucide-react'
import { Badge, Button, Tooltip } from '@/components/emcn'
import { Skeleton } from '@/components/ui/skeleton'

interface TableHeaderBarProps {
  tableName: string
  totalCount: number
  isLoading: boolean
  onNavigateBack: () => void
  onShowSchema: () => void
  onRefresh: () => void
}

/**
 * Renders the header bar with navigation, title, and actions.
 *
 * @param props - Component props
 * @returns Table header bar
 */
export function TableHeaderBar({
  tableName,
  totalCount,
  isLoading,
  onNavigateBack,
  onShowSchema,
  onRefresh,
}: TableHeaderBarProps) {
  return (
    <div className='flex h-[48px] shrink-0 items-center justify-between border-[var(--border)] border-b px-[16px]'>
      <div className='flex items-center gap-[8px]'>
        <button
          onClick={onNavigateBack}
          className='text-[13px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]'
        >
          Tables
        </button>
        <span className='text-[var(--text-muted)]'>/</span>
        <span className='font-medium text-[13px] text-[var(--text-primary)]'>{tableName}</span>
        {isLoading ? (
          <Skeleton className='h-[18px] w-[60px] rounded-full' />
        ) : (
          <Badge variant='gray-secondary' size='sm'>
            {totalCount} {totalCount === 1 ? 'row' : 'rows'}
          </Badge>
        )}
      </div>

      <div className='flex items-center gap-[8px]'>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button variant='ghost' size='sm' onClick={onShowSchema}>
              <Info className='h-[14px] w-[14px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>View Schema</Tooltip.Content>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button variant='ghost' size='sm' onClick={onRefresh}>
              <RefreshCw className='h-[14px] w-[14px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Refresh</Tooltip.Content>
        </Tooltip.Root>
      </div>
    </div>
  )
}
