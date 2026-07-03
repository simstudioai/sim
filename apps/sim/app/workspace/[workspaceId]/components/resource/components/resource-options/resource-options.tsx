import { memo, type ReactNode, useState } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Chip,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ListFilter,
  POPOVER_ANIMATION_CLASSES,
  Search,
  X,
} from '@sim/emcn'
import { FloatingOverflowText } from '@/app/workspace/[workspaceId]/components/resource/components/floating-overflow-text'

const SEARCH_ICON = (
  <Search className='pointer-events-none size-[14px] shrink-0 text-[var(--text-muted)]' />
)

const RESOURCE_MENU_EDGE_OFFSET = 6

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

/**
 * The Filter control has two shapes, picked by `mode`:
 * - `popover` (default): list pages pass the filter controls as `content`; the
 *   button opens them in a popover. `active` highlights the button.
 * - `toggle`: detail views (e.g. the table editor) that render their filter as a
 *   separate panel toggle the button instead of opening a popover.
 */
export type FilterConfig =
  | { mode?: 'popover'; content: ReactNode; active?: boolean }
  | { mode: 'toggle'; active: boolean; onToggle: () => void }

interface ResourceOptionsProps {
  search?: SearchConfig
  sort?: SortConfig
  filter?: FilterConfig
  filterTags?: FilterTag[]
  /**
   * Lightweight control rendered immediately to the LEFT of the filter/sort
   * cluster, forming one group with it — e.g. the knowledge view's
   * connected-source badge or the table editor's embedded run/stop control. With
   * a search the group is pushed right (opposite the search); without one it
   * stays left-aligned (the embedded table editor). Keep it to badges/status
   * widgets; primary actions belong in the header's `actions`.
   */
  aside?: ReactNode
}

export const ResourceOptions = memo(function ResourceOptions({
  search,
  sort,
  filter,
  filterTags,
  aside,
}: ResourceOptionsProps) {
  /**
   * Coordinates the Filter popover and Sort menu as a single menu bar: clicking
   * one while the other is open switches to it in a single click. Functional
   * updates make the close→open ordering race-proof, so whichever menu the click
   * targets wins regardless of which `onOpenChange` fires first.
   */
  const [openMenu, setOpenMenu] = useState<'filter' | 'sort' | null>(null)

  const isToggleFilter = filter?.mode === 'toggle'
  const popoverFilter = filter && filter.mode !== 'toggle' ? filter : null

  const hasContent = search || sort || filter || aside || (filterTags && filterTags.length > 0)
  if (!hasContent) return null

  return (
    <div className={cn('border-[var(--border)] border-b py-2.5', search ? 'px-6' : 'px-4')}>
      <div className='flex items-center'>
        {search && <SearchSection search={search} />}
        <div className={cn('flex shrink-0 items-center gap-1.5', search && 'ml-auto')}>
          {aside}
          <div className='flex items-center'>
            {filterTags?.map((tag) => (
              <Chip key={tag.label} rightIcon={X} onClick={tag.onRemove}>
                {tag.label}
              </Chip>
            ))}
            {isToggleFilter && filter.mode === 'toggle' ? (
              <Chip active={filter.active} leftIcon={ListFilter} onClick={filter.onToggle}>
                Filter
              </Chip>
            ) : popoverFilter ? (
              <PopoverPrimitive.Root
                open={openMenu === 'filter'}
                onOpenChange={(open) =>
                  setOpenMenu((current) =>
                    open ? 'filter' : current === 'filter' ? null : current
                  )
                }
              >
                <PopoverPrimitive.Anchor asChild>
                  <div className='flex items-center'>
                    <PopoverPrimitive.Trigger asChild>
                      <Chip active={popoverFilter.active} leftIcon={ListFilter}>
                        Filter
                      </Chip>
                    </PopoverPrimitive.Trigger>
                    {sort && (
                      <SortDropdown
                        config={sort}
                        open={openMenu === 'sort'}
                        onOpenChange={(open) =>
                          setOpenMenu((current) =>
                            open ? 'sort' : current === 'sort' ? null : current
                          )
                        }
                      />
                    )}
                  </div>
                </PopoverPrimitive.Anchor>
                <PopoverPrimitive.Portal>
                  <PopoverPrimitive.Content
                    align='end'
                    alignOffset={RESOURCE_MENU_EDGE_OFFSET}
                    collisionPadding={6}
                    sideOffset={6}
                    className={cn(
                      POPOVER_ANIMATION_CLASSES,
                      'z-50 w-fit origin-[--radix-popover-content-transform-origin] rounded-xl border border-[var(--border)] bg-[var(--bg)] shadow-sm'
                    )}
                  >
                    {popoverFilter.content}
                  </PopoverPrimitive.Content>
                </PopoverPrimitive.Portal>
              </PopoverPrimitive.Root>
            ) : null}
            {sort && (isToggleFilter || !popoverFilter) && <SortDropdown config={sort} />}
          </div>
        </div>
      </div>
    </div>
  )
})

const SearchSection = memo(function SearchSection({ search }: { search: SearchConfig }) {
  return (
    <div className='relative flex flex-1 items-center gap-1.5'>
      {SEARCH_ICON}
      <div className='flex flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        {search.tags?.map((tag, i) => (
          <Chip
            key={`${tag.label}-${tag.value}`}
            rightIcon={X}
            onClick={tag.onRemove}
            active={search.highlightedTagIndex === i}
            className='max-w-[280px] shrink-0'
          >
            <FloatingOverflowText label={`${tag.label}: ${tag.value}`} className='block truncate'>
              {tag.label}: {tag.value}
            </FloatingOverflowText>
          </Chip>
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
          className='min-w-[80px] flex-1 bg-transparent py-1 text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)]'
        />
      </div>
      {search.tags?.length || search.value ? (
        <button
          type='button'
          className='mr-0.5 flex size-[14px] shrink-0 items-center justify-center text-[var(--text-muted)] transition-colors hover-hover:text-[var(--text-body)]'
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

interface SortDropdownProps {
  config: SortConfig
  /** Controlled open state — omit for standalone (uncontrolled) usage. */
  open?: boolean
  /** Controlled open-change handler, paired with {@link SortDropdownProps.open}. */
  onOpenChange?: (open: boolean) => void
}

export const SortDropdown = memo(function SortDropdown({
  config,
  open,
  onOpenChange,
}: SortDropdownProps) {
  const { options, active, onSort, onClear } = config

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Chip active={Boolean(active)} leftIcon={ArrowUpDown}>
          Sort
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        alignOffset={RESOURCE_MENU_EDGE_OFFSET}
        className='max-h-[var(--radix-dropdown-menu-content-available-height,400px)]'
      >
        {active && onClear && (
          <>
            <DropdownMenuItem onSelect={onClear}>
              <X />
              Clear sort
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
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
                <DirectionIcon className='ml-auto size-[12px] text-[var(--text-tertiary)]' />
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
