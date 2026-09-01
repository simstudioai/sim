'use client'

import * as React from 'react'
import { ChevronDown } from '../../icons'
import { cn } from '../../lib/cn'
import { chipVariants, TRIGGER_BORDER_CLASS } from '../chip/chip'
import { chipIconSlotClass } from '../chip/chip-chrome'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemLabel,
  DropdownMenuLabel,
  DropdownMenuSearchInput,
  DropdownMenuTrigger,
} from '../dropdown-menu/dropdown-menu'
import { OverflowText, overflowTextClipClass } from '../overflow-text/overflow-text'

/** A selectable option in a {@link ChipSelect}. */
export interface ChipSelectOption {
  label: string
  value: string
  /** Additional search-only terms. These are never rendered in the option label. */
  searchTerms?: readonly string[]
  /** Optional leading icon. */
  icon?: React.ComponentType<{ className?: string }>
  /** Whether this option is non-selectable. */
  disabled?: boolean
}

/** A labeled group of options. When `groups` is set, `options` is ignored. */
export interface ChipSelectOptionGroup {
  /** Optional section header rendered above the group. */
  section?: string
  items: ChipSelectOption[]
}

export interface ChipSelectProps {
  /** Options in display order. Ignored when `groups` is provided. */
  options?: ChipSelectOption[]
  /** Grouped options with optional section headers. */
  groups?: ChipSelectOptionGroup[]
  /** Selected value (single-select mode). */
  value?: string
  /** Called with the next value when an option is chosen (single-select). */
  onChange?: (value: string) => void
  /** Enable multi-select: options render as checkbox rows and the menu stays open. */
  multiSelect?: boolean
  /** Selected values (multi-select mode). */
  multiSelectValues?: string[]
  /** Called with the next values when a checkbox toggles (multi-select). */
  onMultiSelectChange?: (values: string[]) => void
  /** Trigger text when nothing is selected. */
  placeholder?: string
  /** Overrides the computed trigger label (e.g. a custom "N selected" string). */
  displayLabel?: React.ReactNode
  /** Disable the trigger. */
  disabled?: boolean
  /** Render an in-menu search box (for long option lists). */
  searchable?: boolean
  /** Placeholder for the in-menu search box. */
  searchPlaceholder?: string
  /** Multi-select only: render an "All" row at the top that clears the selection. */
  showAllOption?: boolean
  /** Label for the "All" row (default "All"). Also the trigger label when nothing is selected. */
  allOptionLabel?: string
  /** Menu alignment relative to the trigger. */
  align?: 'start' | 'center' | 'end'
  /**
   * Stretch the trigger to fill its container and right-align the chevron —
   * use inside form fields. Defaults to a content-width chip (toolbar filters).
   */
  fullWidth?: boolean
  /** Menu width — 'trigger' matches the trigger, a number is px; defaults to a 160px min. */
  dropdownWidth?: 'trigger' | number
  /** Max height of the menu in px (defaults to the menu's 240px). */
  maxHeight?: number
  /**
   * Keep the menu below its trigger and shrink it to the remaining viewport
   * height instead of allowing collision handling to flip it above. Use this
   * for long form-field menus that would otherwise obscure preceding fields.
   */
  stayBelow?: boolean
  /** Forwarded to the trigger button. */
  className?: string
  /** Forwarded to the menu content. */
  contentClassName?: string
  /** Accessible label for the trigger. */
  'aria-label'?: string
  /** Marks the trigger as required. */
  'aria-required'?: React.AriaAttributes['aria-required']
  /** Marks the trigger as invalid. */
  'aria-invalid'?: React.AriaAttributes['aria-invalid']
  /** Id of hint or error content describing the trigger. */
  'aria-describedby'?: React.AriaAttributes['aria-describedby']
  /**
   * Forwarded to the underlying `DropdownMenu`'s Radix `modal` prop
   * (default `true`, matching Radix). Set `false` when an `onChange` handler
   * opens a second overlay (e.g. a `Popover`) in the same tick a selection is
   * made — a modal menu's focus-lock teardown can trap that overlay
   * non-interactive.
   */
  modal?: boolean
}

/** Matches an option label or one of its search-only aliases. */
export function chipSelectOptionMatchesSearch(option: ChipSelectOption, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true
  return [option.label, ...(option.searchTerms ?? [])].some((term) =>
    term.trim().toLowerCase().includes(normalizedQuery)
  )
}

/**
 * The platform filter dropdown: a `filled` chip trigger with a trailing
 * chevron that opens a `DropdownMenu`. This is the same pattern the
 * integrations page uses for its category filter — use it for every settings
 * filter so they read identically.
 *
 * Supports single-select (plain rows), multi-select (`multiSelect` →
 * checkbox rows, menu stays open, optional "All" clear row via
 * `showAllOption`), grouped options (`groups` → section headers), and an
 * optional in-menu search (`searchable`) for long lists.
 *
 * @example
 * ```tsx
 * <ChipSelect
 *   value={range}
 *   onChange={setRange}
 *   options={[{ value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }]}
 * />
 * ```
 */
export function ChipSelect({
  options,
  groups,
  value,
  onChange,
  multiSelect = false,
  multiSelectValues,
  onMultiSelectChange,
  placeholder = 'Select...',
  displayLabel,
  disabled = false,
  searchable = false,
  searchPlaceholder = 'Search...',
  showAllOption = false,
  allOptionLabel = 'All',
  align = 'end',
  fullWidth = false,
  dropdownWidth,
  maxHeight,
  stayBelow = false,
  className,
  contentClassName,
  'aria-label': ariaLabel,
  'aria-required': ariaRequired,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  modal,
}: ChipSelectProps) {
  const [query, setQuery] = React.useState('')

  const selectedValues = multiSelectValues ?? []

  /** Normalized sections — either the provided groups or a single anonymous group. */
  const sections = React.useMemo<ChipSelectOptionGroup[]>(
    () => groups ?? [{ items: options ?? [] }],
    [groups, options]
  )

  const allOptions = React.useMemo(() => sections.flatMap((g) => g.items), [sections])

  const triggerLabel = React.useMemo(() => {
    if (multiSelect) {
      if (selectedValues.length === 0) return showAllOption ? allOptionLabel : placeholder
      if (selectedValues.length === 1) {
        return allOptions.find((o) => o.value === selectedValues[0])?.label ?? placeholder
      }
      return `${selectedValues.length} selected`
    }
    if (value == null || value === '') return placeholder
    return allOptions.find((o) => o.value === value)?.label ?? placeholder
  }, [multiSelect, selectedValues, showAllOption, allOptionLabel, placeholder, value, allOptions])

  const filteredSections = React.useMemo(() => {
    if (!searchable || !query.trim()) return sections
    return sections
      .map((g) => ({ ...g, items: g.items.filter((o) => chipSelectOptionMatchesSearch(o, query)) }))
      .filter((g) => g.items.length > 0)
  }, [searchable, query, sections])

  const hasResults = filteredSections.some((g) => g.items.length > 0)
  const visibleLabel = displayLabel ?? triggerLabel

  const toggleValue = (val: string) => {
    if (selectedValues.includes(val)) {
      onMultiSelectChange?.(selectedValues.filter((v) => v !== val))
    } else {
      onMultiSelectChange?.([...selectedValues, val])
    }
  }

  /**
   * Inline size constraints for the menu surface. When an explicit
   * `dropdownWidth` is set it must also lift the menu's generic
   * `max-w-[220px]` cap, otherwise the requested width would be clamped.
   */
  const contentStyle: React.CSSProperties = {}
  if (dropdownWidth === 'trigger') contentStyle.width = 'var(--radix-dropdown-menu-trigger-width)'
  else if (typeof dropdownWidth === 'number') contentStyle.width = dropdownWidth
  if (dropdownWidth != null) contentStyle.maxWidth = 'none'
  if (stayBelow) {
    const preferredMaxHeight = typeof maxHeight === 'number' ? `${maxHeight}px` : '240px'
    contentStyle.maxHeight = `min(${preferredMaxHeight}, var(--radix-dropdown-menu-content-available-height))`
  } else if (typeof maxHeight === 'number') {
    contentStyle.maxHeight = maxHeight
  }

  const renderOption = (opt: ChipSelectOption) => {
    const Icon = opt.icon
    if (multiSelect) {
      return (
        <DropdownMenuCheckboxItem
          key={opt.value}
          checked={selectedValues.includes(opt.value)}
          disabled={opt.disabled}
          onSelect={(event) => {
            event.preventDefault()
            toggleValue(opt.value)
          }}
        >
          {Icon ? <Icon className='mr-2 size-[14px] text-[var(--text-icon)]' /> : null}
          {opt.label}
        </DropdownMenuCheckboxItem>
      )
    }
    return (
      <DropdownMenuItem
        key={opt.value}
        disabled={opt.disabled}
        onSelect={() => onChange?.(opt.value)}
      >
        {Icon ? <Icon /> : null}
        <DropdownMenuItemLabel label={opt.label} />
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenu
      modal={modal}
      onOpenChange={(open) => {
        if (!open) setQuery('')
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          disabled={disabled}
          aria-label={ariaLabel}
          aria-required={ariaRequired}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          className={cn(
            chipVariants({ variant: 'filled', fullWidth }),
            TRIGGER_BORDER_CLASS,
            fullWidth ? 'justify-between' : 'w-fit max-w-[240px]',
            className
          )}
        >
          {typeof visibleLabel === 'string' || typeof visibleLabel === 'number' ? (
            <OverflowText
              label={String(visibleLabel)}
              className='flex-1 text-[var(--text-body)]'
              focusTarget='nearest-interactive'
            />
          ) : (
            <span className={cn(overflowTextClipClass, 'flex-1 text-[var(--text-body)]')}>
              {visibleLabel}
            </span>
          )}
          <span aria-hidden className={cn(chipIconSlotClass, 'text-[var(--text-icon)]')}>
            <ChevronDown className='size-[14px]' />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side={stayBelow ? 'bottom' : undefined}
        avoidCollisions={stayBelow ? false : undefined}
        onOpenAutoFocus={searchable ? (e) => e.preventDefault() : undefined}
        style={contentStyle}
        className={cn('min-w-[160px]', contentClassName)}
      >
        {searchable ? (
          <DropdownMenuSearchInput
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        ) : null}

        {multiSelect && showAllOption ? (
          <DropdownMenuCheckboxItem
            checked={selectedValues.length === 0}
            onSelect={(event) => {
              event.preventDefault()
              onMultiSelectChange?.([])
            }}
          >
            {allOptionLabel}
          </DropdownMenuCheckboxItem>
        ) : null}

        {hasResults ? (
          filteredSections.map((group, index) => (
            <React.Fragment key={group.section ?? `group-${index}`}>
              {group.section ? <DropdownMenuLabel>{group.section}</DropdownMenuLabel> : null}
              {group.items.map(renderOption)}
            </React.Fragment>
          ))
        ) : (
          <div className='px-2 py-4 text-center text-[var(--text-muted)] text-small'>
            No results
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
