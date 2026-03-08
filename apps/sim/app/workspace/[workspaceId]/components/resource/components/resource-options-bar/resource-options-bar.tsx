import type { ReactNode } from 'react'
import { ArrowUpDown, Button, ListFilter, Search } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

interface ResourceOptionsBarProps {
  search?: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
  }
  onSort?: () => void
  onFilter?: () => void
  toolbarActions?: ReactNode
}

export function ResourceOptionsBar({
  search,
  onSort,
  onFilter,
  toolbarActions,
}: ResourceOptionsBarProps) {
  const hasContent = search || onSort || onFilter
  if (!hasContent) return null

  return (
    <div
      className={cn(
        'border-[var(--border)] border-b py-[10px]',
        search ? 'px-[24px]' : 'px-[16px]'
      )}
    >
      <div className='flex items-center justify-between'>
        {search && (
          <div className='relative flex-1'>
            <Search className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-0 h-[14px] w-[14px] text-[var(--text-muted)]' />
            <input
              type='text'
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder ?? 'Search...'}
              className='w-full bg-transparent py-[4px] pl-[24px] font-base text-[12px] text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-subtle)]'
            />
          </div>
        )}
        <div className='flex items-center gap-[6px]'>
          {onFilter && (
            <Button variant='subtle' className='px-[8px] py-[4px] text-[12px]' onClick={onFilter}>
              <ListFilter className='mr-[6px] h-[14px] w-[14px]' />
              Filter
            </Button>
          )}
          {onSort && (
            <Button variant='subtle' className='px-[8px] py-[4px] text-[12px]' onClick={onSort}>
              <ArrowUpDown className='mr-[6px] h-[14px] w-[14px]' />
              Sort
            </Button>
          )}
          {toolbarActions}
        </div>
      </div>
    </div>
  )
}
