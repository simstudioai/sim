import { memo, type ReactNode } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ListFilter,
  Search,
  X,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

type SortDirection = 'asc' | 'desc'

export interface ColumnOption {
  id: string
  label: string
  type?: string
  icon?: React.ElementType
}

export interface SortConfig {
  options: ColumnOption[]
  active: { column: string; direction: SortDirection } | null
  onSort: (column: string, direction: SortDirection) => void
  onClear?: () => void
}

export interface FilterTag {
  label: string
  onRemove: () => void
}

export interface SearchTag {
  label: string
  value: string
  onRemove: () => void
}

export interface SearchConfig {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onFocus?: () => void
  onBlur?: () => void
  tags?: SearchTag[]
  highlightedTagIndex?: number | null
  onClearAll?: () => void
  dropdown?: ReactNode
  dropdownRef?: React.RefObject<HTMLDivElement | null>
}

interface ResourceOptionsBarProps {
  search?: SearchConfig
  sort?: SortConfig
  filter?: ReactNode
  filterTags?: FilterTag[]
  extras?: ReactNode
}

export const ResourceOptionsBar = memo(function ResourceOptionsBar({
  search,
  sort,
  filter,
  filterTags,
  extras,
}: ResourceOptionsBarProps) {
  const hasContent = search || sort || filter || extras || (filterTags && filterTags.length > 0)
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
          <div className='relative flex flex-1 items-center'>
            <Search className='pointer-events-none h-[14px] w-[14px] shrink-0 text-[var(--text-icon)]' />
            <div className='flex flex-1 items-center gap-[6px] overflow-x-auto pl-[10px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
              {search.tags?.map((tag, i) => (
                <Button
                  key={`${tag.label}-${tag.value}-${i}`}
                  variant='subtle'
                  className={cn(
                    'shrink-0 px-[8px] py-[4px] text-[12px]',
                    search.highlightedTagIndex === i &&
                      'ring-1 ring-[var(--border-focus)] ring-offset-1'
                  )}
                  onClick={tag.onRemove}
                >
                  {tag.label}: {tag.value}
                  <span className='ml-[4px] text-[10px] text-[var(--text-icon)]'>✕</span>
                </Button>
              ))}
              <input
                ref={search.inputRef}
                type='text'
                value={search.value}
                onChange={(e) => search.onChange(e.target.value)}
                onKeyDown={search.onKeyDown}
                onFocus={search.onFocus}
                onBlur={search.onBlur}
                placeholder={search.tags?.length ? '' : (search.placeholder ?? 'Search...')}
                className='min-w-[80px] flex-1 bg-transparent py-[4px] text-[12px] text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-subtle)]'
              />
            </div>
            {search.tags?.length || search.value ? (
              <button
                type='button'
                className='mr-[2px] flex h-[14px] w-[14px] shrink-0 items-center justify-center text-[var(--text-subtle)] transition-colors hover:text-[var(--text-secondary)]'
                onClick={search.onClearAll}
              >
                <span className='text-[12px]'>✕</span>
              </button>
            ) : null}
            {search.dropdown && (
              <div
                ref={search.dropdownRef}
                className='absolute top-full left-0 z-50 mt-[6px] w-full rounded-[8px] border border-[var(--border)] bg-[var(--bg)] shadow-sm'
              >
                {search.dropdown}
              </div>
            )}
          </div>
        )}
        <div className='flex items-center gap-[6px]'>
          {extras}
          {filterTags?.map((tag) => (
            <Button
              key={tag.label}
              variant='subtle'
              className='px-[8px] py-[4px] text-[12px]'
              onClick={tag.onRemove}
            >
              {tag.label}
              <span className='ml-[4px] text-[10px] text-[var(--text-icon)]'>✕</span>
            </Button>
          ))}
          {filter && (
            <PopoverPrimitive.Root>
              <PopoverPrimitive.Trigger asChild>
                <Button variant='subtle' className='px-[8px] py-[4px] text-[12px]'>
                  <ListFilter className='mr-[6px] h-[14px] w-[14px] text-[var(--text-icon)]' />
                  Filter
                </Button>
              </PopoverPrimitive.Trigger>
              <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                  align='start'
                  sideOffset={6}
                  className={cn(
                    'z-50 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] shadow-sm'
                  )}
                >
                  {filter}
                </PopoverPrimitive.Content>
              </PopoverPrimitive.Portal>
            </PopoverPrimitive.Root>
          )}
          {sort && <SortDropdown config={sort} />}
        </div>
      </div>
    </div>
  )
})

function SortDropdown({ config }: { config: SortConfig }) {
  const { options, active, onSort, onClear } = config

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='subtle' className='px-[8px] py-[4px] text-[12px]'>
          <ArrowUpDown className='mr-[6px] h-[14px] w-[14px] text-[var(--text-icon)]' />
          Sort
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {options.map((option) => {
          const isActive = active?.column === option.id
          const Icon = option.icon
          const DirectionIcon = isActive ? (active.direction === 'asc' ? ArrowUp : ArrowDown) : null

          return (
            <DropdownMenuItem
              key={option.id}
              onSelect={() => {
                if (isActive) {
                  onSort(option.id, active.direction === 'asc' ? 'desc' : 'asc')
                } else {
                  onSort(option.id, 'desc')
                }
              }}
            >
              {Icon && <Icon />}
              {option.label}
              {DirectionIcon && (
                <DirectionIcon className='ml-auto h-[12px] w-[12px] text-[var(--text-tertiary)]' />
              )}
            </DropdownMenuItem>
          )
        })}
        {active && onClear && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onClear}>
              <X />
              Clear sort
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
