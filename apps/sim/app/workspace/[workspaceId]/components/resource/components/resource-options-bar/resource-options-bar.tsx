import type { ReactNode } from 'react'
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

interface ResourceOptionsBarProps {
  search?: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
  }
  sort?: SortConfig
  filter?: ReactNode
}

export function ResourceOptionsBar({ search, sort, filter }: ResourceOptionsBarProps) {
  const hasContent = search || sort || filter
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
          <div className='flex flex-1 items-center'>
            <Search className='pointer-events-none h-[14px] w-[14px] shrink-0 text-[var(--text-icon)]' />
            <input
              type='text'
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder ?? 'Search...'}
              className='w-full bg-transparent py-[4px] pl-[10px] text-[12px] text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-subtle)]'
            />
          </div>
        )}
        <div className='flex items-center gap-[6px]'>
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
                    'z-50 rounded-[8px] border border-[var(--border)] bg-white shadow-sm dark:bg-[var(--bg)]'
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
}

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
            <DropdownMenuItem onSelect={onClear} className='text-[var(--text-tertiary)]'>
              Clear sort
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
