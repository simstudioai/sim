'use client'

import { type ComponentType, forwardRef, type ReactNode, useMemo, useState } from 'react'
import type { VariantProps } from 'class-variance-authority'
import { chipVariants, TRIGGER_BORDER_CLASS } from '@/components/emcn/components/chip/chip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSearchInput,
  DropdownMenuTrigger,
} from '@/components/emcn/components/dropdown-menu/dropdown-menu'
import { Check, ChevronDown } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'

type ChipIcon = ComponentType<{ className?: string }>

/**
 * Single option rendered inside a {@link ChipMultiSelect}.
 */
interface ChipMultiSelectOption {
  /** Stable identifier toggled in/out of the selected `values`. */
  value: string
  /** Visual label rendered in the menu and (when only one is picked) the trigger. */
  label: string
  /** Optional leading icon component rendered inside the menu item. */
  icon?: ChipIcon
  /** Pre-rendered leading element (e.g. an avatar) — takes precedence over `icon`. */
  iconElement?: ReactNode
}

interface ChipMultiSelectProps
  extends Pick<VariantProps<typeof chipVariants>, 'fullWidth' | 'flush'> {
  /** Currently selected values. Empty array reads as "all" / no filter. */
  values: string[]
  /** Called with the next selected values when an option is toggled. */
  onChange: (values: string[]) => void
  /** Options to render in the menu. */
  options: ReadonlyArray<ChipMultiSelectOption>
  /** Label shown in the trigger and as the reset row when nothing is selected. */
  allLabel?: string
  /**
   * Whether to render the leading "all" reset row inside the menu. Defaults to
   * `true` for filter-style use (empty selection reads as "all"). Set `false`
   * for selection-style pickers where an empty list is a real "nothing
   * selected" state rather than an "all" shortcut.
   */
  showAllOption?: boolean
  /** Renders a search field at the top of the menu that filters options by label. */
  searchable?: boolean
  /** Placeholder for the search field. */
  searchPlaceholder?: string
  /** Aligns the menu relative to the trigger. */
  align?: 'start' | 'center' | 'end'
  /**
   * Whether the menu width matches the trigger's (default `true`). Set `false`
   * to let the menu size to its widest item instead.
   */
  matchTriggerWidth?: boolean
  /** Forwarded to the inner `DropdownMenuContent`. */
  contentClassName?: string
  /** Disables the trigger. */
  disabled?: boolean
  /** Forwarded class for the trigger button. */
  className?: string
}

/**
 * Multi-select counterpart to {@link ChipDropdown} — a chip trigger that opens a
 * menu of toggleable options with a leading "all" reset row and an optional
 * search field. The menu stays open across selections; a trailing check marks
 * each active option, matching `ChipDropdown`'s single-select affordance.
 *
 * @example
 * <ChipMultiSelect
 *   options={memberOptions}
 *   values={ownerFilter}
 *   onChange={setOwnerFilter}
 *   allLabel='All'
 *   searchable
 *   searchPlaceholder='Search members...'
 *   fullWidth
 *   flush
 * />
 */
const ChipMultiSelect = forwardRef<HTMLButtonElement, ChipMultiSelectProps>(
  function ChipMultiSelect(
    {
      values,
      onChange,
      options,
      allLabel = 'All',
      showAllOption = true,
      searchable = false,
      searchPlaceholder = 'Search...',
      align = 'start',
      matchTriggerWidth = true,
      contentClassName,
      disabled,
      fullWidth,
      flush,
      className,
    },
    ref
  ) {
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')

    const displayLabel =
      values.length === 0
        ? allLabel
        : values.length === 1
          ? (options.find((o) => o.value === values[0])?.label ?? allLabel)
          : `${values.length} selected`

    const filteredOptions = useMemo(() => {
      const query = search.trim().toLowerCase()
      if (!searchable || !query) return options
      return options.filter((option) => option.label.toLowerCase().includes(query))
    }, [options, searchable, search])

    const toggle = (value: string) => {
      onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value])
    }

    return (
      <DropdownMenu
        modal={false}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setSearch('')
        }}
      >
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            ref={ref}
            type='button'
            disabled={disabled}
            className={cn(
              chipVariants({ variant: 'filled', fullWidth, flush }),
              TRIGGER_BORDER_CLASS,
              className
            )}
          >
            <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-sm'>
              {displayLabel}
            </span>
            <span
              aria-hidden
              className='inline-flex size-[16px] flex-shrink-0 items-center justify-center text-[var(--text-icon)]'
            >
              <ChevronDown className='h-[6px] w-[10px]' />
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          onOpenAutoFocus={searchable ? (event) => event.preventDefault() : undefined}
          className={cn(
            'z-[var(--z-popover)]',
            matchTriggerWidth && 'w-[var(--radix-dropdown-menu-trigger-width)] max-w-none',
            contentClassName
          )}
        >
          {searchable && (
            <DropdownMenuSearchInput
              placeholder={searchPlaceholder}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setOpen(false)
              }}
            />
          )}
          {showAllOption && (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                onChange([])
              }}
            >
              <span>{allLabel}</span>
              {values.length === 0 ? <Check className='!ml-auto !size-[16px]' /> : null}
            </DropdownMenuItem>
          )}
          {filteredOptions.map((option) => {
            const isSelected = values.includes(option.value)
            const OptionIcon = option.icon
            return (
              <DropdownMenuItem
                key={option.value}
                onSelect={(event) => {
                  event.preventDefault()
                  toggle(option.value)
                }}
              >
                {option.iconElement ?? (OptionIcon ? <OptionIcon /> : null)}
                <span>{option.label}</span>
                {isSelected ? <Check className='!ml-auto !size-[16px]' /> : null}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
)

ChipMultiSelect.displayName = 'ChipMultiSelect'

export { ChipMultiSelect }
export type { ChipMultiSelectOption, ChipMultiSelectProps }
