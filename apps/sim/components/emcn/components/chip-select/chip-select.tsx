'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { chipVariants, TRIGGER_BORDER_CLASS } from '@/components/emcn/components/chip/chip'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSearchInput,
  DropdownMenuTrigger,
} from '@/components/emcn/components/dropdown-menu/dropdown-menu'
import { ChevronDown } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'

/** A selectable option in a {@link ChipSelect}. */
export interface ChipSelectOption {
  label: string
  value: string
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
  /** Forwarded to the trigger button. */
  className?: string
  /** Forwarded to the menu content. */
  contentClassName?: string
  /** Accessible label for the trigger. */
  'aria-label'?: string
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
  className,
  contentClassName,
  'aria-label': ariaLabel,
}: ChipSelectProps) {
  const t = useTranslations('auto')
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
    const q = query.toLowerCase()
    return sections
      .map((g) => ({ ...g, items: g.items.filter((o) => o.label.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length > 0)
  }, [searchable, query, sections])

  const hasResults = filteredSections.some((g) => g.items.length > 0)

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
  if (typeof maxHeight === 'number') contentStyle.maxHeight = maxHeight

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
        <span>{opt.label}</span>
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) setQuery('')
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            chipVariants({ variant: 'filled', flush: true, fullWidth }),
            TRIGGER_BORDER_CLASS,
            fullWidth ? 'w-full justify-between' : 'w-fit max-w-[240px]',
            className
          )}
        >
          <span className='min-w-0 truncate text-[var(--text-body)]'>
            {displayLabel ?? triggerLabel}
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
            {t('no_results')}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
