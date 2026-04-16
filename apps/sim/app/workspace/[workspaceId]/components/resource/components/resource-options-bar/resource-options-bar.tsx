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

const SEARCH_ICON = (
  <Search className='pointer-events-none h-[14px] w-[14px] shrink-0 text-[var(--text-icon)]' />
)

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
  /** Popover content — renders inside a Popover (used by logs, etc.) */
  filter?: ReactNode
  /** When provided, Filter button acts as a toggle instead of opening a Popover */
  onFilterToggle?: () => void
  /** Whether the filter is currently active (highlights the toggle button) */
  filterActive?: boolean
  filterTags?: FilterTag[]
  extras?: ReactNode
}

export const ResourceOptionsBar = memo(function ResourceOptionsBar({
  search,
  sort,
  filter,
  onFilterToggle,
  filterActive,
  filterTags,
  extras,
}: ResourceOptionsBarProps) {
  const hasContent =
    search || sort || filter || onFilterToggle || extras || (filterTags && filterTags.length > 0)
  if (!hasContent) return null

  return (
    <div className={cn('border-[var(--border)] border-b py-2.5', search ? 'px-6' : 'px-4')}>
      <div className='flex items-center justify-between'>
        {search && <SearchSection search={search} />}
        <div className='flex items-center gap-1.5'>
          {extras}
          {filterTags?.map((tag, i) => (
            <Button
              key={`${tag.label}-${i}`}
              variant='subtle'
              className='max-w-[200px] px-2 py-1 text-caption'
              onClick={tag.onRemove}
            >
              <span className='truncate'>{tag.label}</span>
              <span className='ml-1 shrink-0 text-[var(--text-icon)] text-micro'>✕</span>
            </Button>
          ))}
          {onFilterToggle ? (
            <Button
              variant='subtle'
              className={cn(
                'px-2 py-1 text-caption',
                filterActive && 'bg-[var(--surface-3)] text-[var(--text-primary)]'
              )}
              onClick={onFilterToggle}
            >
              <ListFilter
                className={cn(
                  'mr-1.5 h-[14px] w-[14px]',
                  filterActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-icon)]'
                )}
              />
              Filter
            </Button>
          ) : filter ? (
            <PopoverPrimitive.Root>
              <PopoverPrimitive.Trigger asChild>
                <Button variant='subtle' className='px-2 py-1 text-caption'>
                  <ListFilter className='mr-1.5 h-[14px] w-[14px] text-[var(--text-icon)]' />
                  Filter
                </Button>
              </PopoverPrimitive.Trigger>
              <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                  align='start'
                  sideOffset={6}
                  className='z-50 w-fit rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-sm'
                >
                  {filter}
                </PopoverPrimitive.Content>
              </PopoverPrimitive.Portal>
            </PopoverPrimitive.Root>
          ) : null}
          {sort && <SortDropdown config={sort} />}
        </div>
      </div>
    </div>
  )
})

const SearchSection = memo(function SearchSection({ search }: { search: SearchConfig }) {
  return (
    <div className='relative flex flex-1 items-center'>
      {SEARCH_ICON}
      <div className='flex flex-1 items-center gap-1.5 overflow-x-auto pl-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        {search.tags?.map((tag, i) => (
          <Button
            key={`${tag.label}-${tag.value}-${i}`}
            variant='subtle'
            className={cn(
              'shrink-0 px-2 py-1 text-caption',
              search.highlightedTagIndex === i && 'ring-1 ring-[var(--border-focus)] ring-offset-1'
            )}
            onClick={tag.onRemove}
          >
            {tag.label}: {tag.value}
            <span className='ml-1 text-[var(--text-icon)] text-micro'>✕</span>
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
          className='min-w-[80px] flex-1 bg-transparent py-1 text-[var(--text-secondary)] text-caption outline-none placeholder:text-[var(--text-subtle)]'
        />
      </div>
      {search.tags?.length || search.value ? (
        <button
          type='button'
          className='mr-0.5 flex h-[14px] w-[14px] shrink-0 items-center justify-center text-[var(--text-subtle)] transition-colors hover-hover:text-[var(--text-secondary)]'
          onClick={search.onClearAll ?? (() => search.onChange(''))}
        >
          <span className='text-caption'>✕</span>
        </button>
      ) : null}
      {search.dropdown && (
        <div
          ref={search.dropdownRef}
          className='absolute top-full left-0 z-50 mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-sm'
        >
          {search.dropdown}
        </div>
      )}
    </div>
  )
})

const SortDropdown = memo(function SortDropdown({ config }: { config: SortConfig }) {
  const { options, active, onSort, onClear } = config

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='subtle'
          className={cn(
            'px-2 py-1 text-caption',
            active && 'bg-[var(--surface-3)] text-[var(--text-primary)]'
          )}
        >
          <ArrowUpDown
            className={cn(
              'mr-1.5 h-[14px] w-[14px]',
              active ? 'text-[var(--text-primary)]' : 'text-[var(--text-icon)]'
            )}
          />
          Sort
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
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
})
