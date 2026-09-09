'use client'

import {
  type ChangeEvent,
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cva, type VariantProps } from 'class-variance-authority'
import { Check, ChevronDown, Loader, Search } from '../../icons'
import { cn } from '../../lib/cn'
import { Button } from '../button/button'
import { chipActiveSurfaceClass, chipHoverSurfaceClass } from '../chip/chip-chrome'
import { Input } from '../input/input'
import { OverflowText } from '../overflow-text/overflow-text'
import { Popover, PopoverAnchor, PopoverContent, PopoverScrollArea } from '../popover/popover'

const comboboxVariants = cva(
  'flex w-full rounded-sm border border-[var(--border-1)] bg-[var(--surface-5)] px-2 font-sans text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: '',
      },
      size: {
        sm: 'py-1.5 text-caption',
        md: 'py-1.5 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
)

const VIRTUALIZE_OPTION_THRESHOLD = 100

/**
 * Represents a selectable option in the combobox
 */
export type ComboboxOption = {
  label: string
  value: string
  /** When true, hidden from the picker list but still resolves for display */
  hidden?: boolean
  /** Icon component to render */
  icon?: React.ComponentType<{ className?: string }>
  /** Pre-rendered icon element (alternative to icon component) */
  iconElement?: ReactNode
  /** Custom select handler - when provided, this is called instead of onChange */
  onSelect?: () => void
  /** Whether this option is disabled */
  disabled?: boolean
  /** When true, keep the dropdown open after selecting this option */
  keepOpen?: boolean
  /** Optional element rendered at the trailing end of the option (e.g. chevron for folders) */
  suffixElement?: ReactNode
}

/**
 * Represents a group of options with an optional section header
 */
export type ComboboxOptionGroup = {
  /** Optional section header label */
  section?: string
  /** Optional custom section header element (overrides section label) */
  sectionElement?: ReactNode
  /** Options in this group */
  items: ComboboxOption[]
}

export interface ComboboxProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'>,
    VariantProps<typeof comboboxVariants> {
  /** Available options for selection */
  options: ComboboxOption[]
  /** Current selected value */
  value?: string
  /** Current selected values for multi-select mode */
  multiSelectValues?: string[]
  /** Callback when value changes */
  onChange?: (value: string) => void
  /** Callback when multi-select values change */
  onMultiSelectChange?: (values: string[]) => void
  /** Placeholder text when no value is selected */
  placeholder?: string
  /** Whether the combobox is disabled */
  disabled?: boolean
  /** Enable free-text input mode (default: false) */
  editable?: boolean
  /** Visual content rendered over the selected value. */
  overlayContent?: ReactNode
  /** Plain-text value represented by a visual overlay in non-editable mode. */
  overlayLabel?: string
  /** Additional input props for editable mode */
  inputProps?: Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'disabled' | 'placeholder'
  >
  /** Ref for the input element in editable mode */
  inputRef?: React.RefObject<HTMLInputElement | null>
  /** Whether to filter options based on input value (default: true for editable mode) */
  filterOptions?: boolean
  /** Explicitly control which option is marked as selected (defaults to `value`) */
  selectedValue?: string
  /** Enable multi-select mode */
  multiSelect?: boolean
  /** Loading state */
  isLoading?: boolean
  /** Error message to display */
  error?: string | null
  /** Callback when popover open state changes */
  onOpenChange?: (open: boolean) => void
  /** Callback when ArrowLeft is pressed while dropdown is open (for folder back-navigation) */
  onArrowLeft?: () => void
  /** Enable search input in dropdown (useful for multiselect) */
  searchable?: boolean
  /**
   * Notified when the dropdown's search box changes value, including the `''` a
   * select, close, Escape, or ArrowLeft resets it to. Deduped, so an already-empty
   * query resetting again is silent and a consumer sees nothing while `searchable`
   * is false.
   *
   * This is the `searchable` search box only. In `editable` mode the typed text
   * arrives via `onChange`, not here.
   *
   * Client-side filtering of `options` is unaffected — this is an additional
   * signal for consumers that also resolve matches server-side.
   */
  onSearchChange?: (query: string) => void
  /** Placeholder for search input */
  searchPlaceholder?: string
  /** Size variant */
  size?: 'sm' | 'md'
  /** Dropdown alignment */
  align?: 'start' | 'center' | 'end'
  /** Dropdown width - 'trigger' matches trigger width, or provide a pixel value */
  dropdownWidth?: 'trigger' | number
  disablePortal?: boolean
  /** Show an "All" option at the top that clears selection (multi-select only) */
  showAllOption?: boolean
  /** Custom label for the "All" option (default: "All") */
  allOptionLabel?: string
  /** Grouped options with section headers - when provided, options prop is ignored */
  groups?: ComboboxOptionGroup[]
  /** Maximum height for the dropdown */
  maxHeight?: number
  /** Empty state message when no options match the search */
  emptyMessage?: string
  /** Whether additional option pages are available. */
  hasMore?: boolean
  /** Whether another option page is loading. */
  isLoadingMore?: boolean
  /** Whether every remaining option page is being searched. */
  isLoadingAll?: boolean
  /** Whether undiscovered provider pages were cut off by the selector safety bound. */
  truncated?: boolean
  /** Whether an externally controlled editable input is actively filtering options. */
  searchActive?: boolean
  /** Loads one additional option page. */
  onLoadMore?: () => void
  /** Loads all remaining option pages within the selector safety bound. */
  onLoadAll?: () => void
}

/**
 * Minimal combobox component matching the input and textarea styling.
 * Provides a dropdown selection interface with keyboard navigation support.
 * Supports both select-only and editable (free-text) modes.
 */
const Combobox = memo(
  forwardRef<HTMLDivElement, ComboboxProps>(
    (
      {
        className,
        variant,
        size,
        options,
        value,
        multiSelectValues,
        onChange,
        onMultiSelectChange,
        placeholder = 'Select...',
        disabled,
        editable = false,
        overlayContent,
        overlayLabel,
        inputProps = {},
        inputRef: externalInputRef,
        filterOptions = editable,
        selectedValue,
        multiSelect = false,
        isLoading = false,
        error = null,
        onOpenChange,
        onArrowLeft,
        searchable = false,
        onSearchChange,
        searchPlaceholder = 'Search...',
        align = 'start',
        dropdownWidth = 'trigger',
        disablePortal = false,
        showAllOption = false,
        allOptionLabel = 'All',
        groups,
        maxHeight = 192,
        emptyMessage,
        hasMore = false,
        isLoadingMore = false,
        isLoadingAll = false,
        truncated = false,
        searchActive = false,
        onLoadMore,
        onLoadAll,
        ...props
      },
      ref
    ) => {
      const listboxId = useId()
      const [open, setOpen] = useState(false)
      const [highlightedIndex, setHighlightedIndex] = useState(-1)
      const [searchQuery, setSearchQueryState] = useState('')
      /**
       * Read through a ref so `updateSearchQuery` keeps a stable identity —
       * `handleSelect`, `handleBlur`, and `handleKeyDown` all capture it without
       * listing it as a dependency.
       */
      const onSearchChangeRef = useRef(onSearchChange)
      useEffect(() => {
        onSearchChangeRef.current = onSearchChange
      }, [onSearchChange])
      /**
       * Single write path for the search box so `onSearchChange` cannot be missed on a
       * reset. Deduped because several paths reset redundantly — Escape both handles the
       * key and lets the popover dismiss, and an editable select blurs after selecting —
       * which the raw setState absorbed silently but a consumer callback would not.
       */
      const searchQueryRef = useRef('')
      const updateSearchQuery = useCallback((next: string) => {
        if (searchQueryRef.current === next) return
        searchQueryRef.current = next
        setSearchQueryState(next)
        onSearchChangeRef.current?.(next)
      }, [])
      /**
       * Read through a ref so `changeOpen` keeps a stable identity — every path
       * that opens or closes the dropdown captures it without listing it as a
       * dependency.
       */
      const onOpenChangeRef = useRef(onOpenChange)
      useEffect(() => {
        onOpenChangeRef.current = onOpenChange
      }, [onOpenChange])
      /**
       * Single write path for the open state so `onOpenChange` cannot be missed.
       * The popover is controlled, so Radix reports only the dismissals it initiates
       * itself; the trigger, chevron, focus, keyboard, and selection paths are all
       * state writes here, and a consumer that refreshes its options on open — or,
       * like the agent block's tool picker, builds them only while open — hears about
       * none of them unless each one reports. Deduped, because several paths both
       * close and let the popover dismiss, which the raw setState absorbed silently
       * but a consumer callback would not. The ref also lets the toggles read the
       * current value without re-creating their handlers on every open.
       */
      const openRef = useRef(false)
      const changeOpen = useCallback(
        (next: boolean) => {
          if (openRef.current === next) return
          openRef.current = next
          setOpen(next)
          if (!next) updateSearchQuery('')
          onOpenChangeRef.current?.(next)
        },
        [updateSearchQuery]
      )
      const searchInputRef = useRef<HTMLInputElement>(null)
      const containerRef = useRef<HTMLDivElement>(null)
      const [scrollArea, setScrollArea] = useState<HTMLDivElement | null>(null)
      const dropdownRef = useRef<HTMLDivElement>(null)
      const blurTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null)
      const internalInputRef = useRef<HTMLInputElement>(null)
      const inputRef = externalInputRef || internalInputRef
      /**
       * True while a pointer press that began inside the dropdown is still held.
       * Grabbing the list's native scrollbar blurs the editable input and parks
       * focus on `<body>` — which `handleBlur` would otherwise read as "focus
       * left the combobox" and close the dropdown mid-drag.
       */
      const pointerDownInsideRef = useRef(false)

      const effectiveSelectedValue = selectedValue ?? value

      // Cleanup blur timeout on unmount
      useEffect(() => {
        return () => {
          if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
        }
      }, [])

      /**
       * Releases the pointer-press window and restores focus to the editable input,
       * which a scrollbar drag left on `<body>`. Bound to `window` so a release
       * outside the popover still clears the flag; `pointercancel` is included
       * because a touch scroll gesture ends there instead of `pointerup`.
       *
       * Focus is only restored when the press actually stole it — a press inside the
       * popover parks it on `<body>` or the `tabIndex={-1}` content, but option
       * mousedown is prevented, so it often never left the input or the search box.
       */
      useEffect(() => {
        if (!editable) return
        const endPointerPress = () => {
          if (!pointerDownInsideRef.current) return
          pointerDownInsideRef.current = false
          const active = document.activeElement
          const isTextEntry =
            active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
          if (!isTextEntry) inputRef.current?.focus({ preventScroll: true })
        }
        window.addEventListener('pointerup', endPointerPress)
        window.addEventListener('pointercancel', endPointerPress)
        return () => {
          window.removeEventListener('pointerup', endPointerPress)
          window.removeEventListener('pointercancel', endPointerPress)
        }
      }, [editable, inputRef])

      // Flatten groups into options if groups are provided
      const allOptions = useMemo(() => {
        if (groups) {
          return groups.flatMap((group) => group.items)
        }
        return options
      }, [groups, options])

      const selectedOption = useMemo(
        () => allOptions.find((opt) => opt.value === effectiveSelectedValue),
        [allOptions, effectiveSelectedValue]
      )

      /**
       * Label rendered in the collapsed trigger for multi-select mode.
       * Shows the single label when one value is picked, comma-joined labels
       * for two, or "first, second +N" when more are selected. Falls back to
       * the raw value if an option for it hasn't loaded yet.
       */
      const multiSelectLabel = useMemo(() => {
        if (!multiSelect || !multiSelectValues || multiSelectValues.length === 0) return null
        const labelFor = (v: string) => allOptions.find((opt) => opt.value === v)?.label ?? v
        if (multiSelectValues.length === 1) return labelFor(multiSelectValues[0])
        if (multiSelectValues.length === 2) {
          return `${labelFor(multiSelectValues[0])}, ${labelFor(multiSelectValues[1])}`
        }
        return `${labelFor(multiSelectValues[0])}, ${labelFor(multiSelectValues[1])} +${multiSelectValues.length - 2}`
      }, [multiSelect, multiSelectValues, allOptions])

      /**
       * Filter options based on current value or search query
       */
      const filteredOptions = useMemo(() => {
        let result = allOptions.filter((opt) => !opt.hidden)

        if (filterOptions && value && open) {
          const currentValue = value.toString().toLowerCase()
          const exactMatch = result.find(
            (opt) => opt.value === value || opt.label.toLowerCase() === currentValue
          )
          if (!exactMatch) {
            result = result.filter((option) => {
              const label = option.label.toLowerCase()
              const optionValue = option.value.toLowerCase()
              return label.includes(currentValue) || optionValue.includes(currentValue)
            })
          }
        }

        if (searchable && searchQuery) {
          const query = searchQuery.toLowerCase()
          result = result.filter((option) => {
            const label = option.label.toLowerCase()
            const optionValue = option.value.toLowerCase()
            return label.includes(query) || optionValue.includes(query)
          })
        }

        return result
      }, [allOptions, value, open, filterOptions, searchable, searchQuery])

      /**
       * Filter groups based on search query (preserves group structure)
       */
      const filteredGroups = useMemo(() => {
        if (!groups) return null

        const baseGroups = groups
          .map((group) => ({
            ...group,
            items: group.items.filter((opt) => !opt.hidden),
          }))
          .filter((group) => group.items.length > 0)

        if (!searchable || !searchQuery) return baseGroups

        const query = searchQuery.toLowerCase()
        return baseGroups
          .map((group) => ({
            ...group,
            items: group.items.filter((option) => {
              const label = option.label.toLowerCase()
              const optionValue = option.value.toLowerCase()
              return label.includes(query) || optionValue.includes(query)
            }),
          }))
          .filter((group) => group.items.length > 0)
      }, [groups, searchable, searchQuery])

      const virtualizeOptions =
        !filteredGroups && !showAllOption && filteredOptions.length >= VIRTUALIZE_OPTION_THRESHOLD
      const optionVirtualizer = useVirtualizer({
        count: virtualizeOptions ? filteredOptions.length : 0,
        getScrollElement: () => scrollArea,
        estimateSize: () => (size === 'sm' ? 28 : 34),
        overscan: 8,
      })
      const hasActiveSearch = searchActive || (searchable && searchQuery.trim().length > 0)
      const continuationAction = hasActiveSearch ? (onLoadAll ?? onLoadMore) : onLoadMore
      const continuationLabel = hasActiveSearch ? 'Search all options' : 'Load more'
      const continuationLoadingLabel = hasActiveSearch
        ? 'Searching options...'
        : 'Loading options...'

      /**
       * Handles selection of an option. In editable mode the input is blurred on
       * purpose, so the pointer-press window is ended first — otherwise the `pointerup`
       * that follows would hand focus back and reopen the dropdown.
       */
      const handleSelect = useCallback(
        (selectedValue: string, customOnSelect?: () => void, keepOpen?: boolean) => {
          // If option has custom onSelect, use it instead
          if (customOnSelect) {
            customOnSelect()
            // Always reset search/highlight so stale queries don't filter new options
            updateSearchQuery('')
            setHighlightedIndex(-1)
            if (!keepOpen) {
              changeOpen(false)
            }
            return
          }

          if (multiSelect && onMultiSelectChange) {
            const currentValues = multiSelectValues || []
            const newValues = currentValues.includes(selectedValue)
              ? currentValues.filter((v) => v !== selectedValue)
              : [...currentValues, selectedValue]
            onMultiSelectChange(newValues)
          } else {
            onChange?.(selectedValue)
            if (!keepOpen) {
              changeOpen(false)
              setHighlightedIndex(-1)
              updateSearchQuery('')
              if (editable && inputRef.current) {
                pointerDownInsideRef.current = false
                inputRef.current.blur()
              }
            }
          }
        },
        [
          onChange,
          multiSelect,
          onMultiSelectChange,
          multiSelectValues,
          editable,
          inputRef,
          changeOpen,
          updateSearchQuery,
        ]
      )

      /**
       * Handles input change for editable mode
       */
      const handleInputChange = useCallback(
        (e: ChangeEvent<HTMLInputElement>) => {
          if (disabled || !editable) return
          onChange?.(e.target.value)
        },
        [disabled, editable, onChange]
      )

      /**
       * Handles focus for editable mode
       */
      const handleFocus = useCallback(() => {
        if (!disabled) {
          changeOpen(true)
          setHighlightedIndex(-1)
        }
      }, [disabled, changeOpen])

      /**
       * Handles blur for editable mode
       */
      const handleBlur = useCallback(() => {
        // Clear any pending blur timeout
        if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
        // Delay to allow dropdown clicks
        blurTimeoutRef.current = setTimeout(() => {
          if (pointerDownInsideRef.current) return
          const activeElement = document.activeElement
          // Check if focus is in the container, dropdown, or search input
          const isInContainer = containerRef.current?.contains(activeElement)
          const isInDropdown = dropdownRef.current?.contains(activeElement)
          const isSearchInput = activeElement === searchInputRef.current
          if (!activeElement || (!isInContainer && !isInDropdown && !isSearchInput)) {
            changeOpen(false)
            setHighlightedIndex(-1)
            updateSearchQuery('')
          }
        }, 150)
      }, [changeOpen, updateSearchQuery])

      /**
       * Handles keyboard navigation
       */
      const handleKeyDown = useCallback(
        (e: KeyboardEvent<HTMLDivElement | HTMLInputElement>) => {
          if (disabled) return

          if (e.key === 'Escape') {
            changeOpen(false)
            setHighlightedIndex(-1)
            updateSearchQuery('')
            if (editable && inputRef.current) {
              inputRef.current.blur()
            }
            return
          }

          if (e.key === 'Enter') {
            if (open && highlightedIndex >= 0) {
              e.preventDefault()
              const selectedOption = filteredOptions[highlightedIndex]
              if (selectedOption && !selectedOption.disabled) {
                handleSelect(selectedOption.value, selectedOption.onSelect, selectedOption.keepOpen)
              }
            } else if (!editable) {
              e.preventDefault()
              changeOpen(true)
              setHighlightedIndex(0)
            }
            return
          }

          if (e.key === ' ' && !editable) {
            e.preventDefault()
            if (!open) {
              changeOpen(true)
              setHighlightedIndex(0)
            }
            return
          }

          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (!open) {
              changeOpen(true)
              setHighlightedIndex(0)
            } else {
              setHighlightedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0))
            }
          }

          if (e.key === 'ArrowUp') {
            e.preventDefault()
            if (open) {
              setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1))
            }
          }

          if (e.key === 'ArrowRight') {
            if (open && highlightedIndex >= 0) {
              const highlightedOption = filteredOptions[highlightedIndex]
              if (highlightedOption?.keepOpen && highlightedOption?.onSelect) {
                e.preventDefault()
                handleSelect(highlightedOption.value, highlightedOption.onSelect, true)
              }
            }
          }

          if (e.key === 'ArrowLeft') {
            if (open && onArrowLeft) {
              e.preventDefault()
              onArrowLeft()
              updateSearchQuery('')
              setHighlightedIndex(-1)
            }
          }
        },
        [
          disabled,
          open,
          highlightedIndex,
          filteredOptions,
          handleSelect,
          editable,
          inputRef,
          onArrowLeft,
          changeOpen,
          updateSearchQuery,
        ]
      )

      /**
       * Handles toggle of dropdown (for select mode only)
       */
      const handleToggle = useCallback(() => {
        if (!disabled && !editable) {
          changeOpen(!openRef.current)
          setHighlightedIndex(-1)
        }
      }, [disabled, editable, changeOpen])

      /**
       * Handles chevron click for editable mode
       */
      const handleChevronClick = useCallback(
        (e: React.MouseEvent) => {
          e.preventDefault()
          e.stopPropagation()
          if (!disabled) {
            const nextOpen = !openRef.current
            changeOpen(nextOpen)
            if (nextOpen && editable && inputRef.current) {
              inputRef.current.focus()
            }
          }
        },
        [disabled, editable, inputRef, changeOpen]
      )

      const effectiveHighlightedIndex =
        highlightedIndex >= 0 && highlightedIndex < filteredOptions.length ? highlightedIndex : -1

      /**
       * Reset highlighted index when filtered options change and index is out of bounds
       */
      useEffect(() => {
        if (highlightedIndex >= 0 && highlightedIndex >= filteredOptions.length) {
          setHighlightedIndex(-1)
        }
      }, [filteredOptions, highlightedIndex])

      /**
       * Scroll highlighted option into view
       */
      useEffect(() => {
        if (effectiveHighlightedIndex < 0) return
        if (virtualizeOptions) {
          optionVirtualizer.scrollToIndex(effectiveHighlightedIndex, { align: 'auto' })
          return
        }
        if (dropdownRef.current) {
          const highlightedElement = dropdownRef.current.querySelector(
            `[data-option-index="${effectiveHighlightedIndex}"]`
          )
          if (highlightedElement) {
            highlightedElement.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest',
            })
          }
        }
      }, [effectiveHighlightedIndex, optionVirtualizer, virtualizeOptions])

      const SelectedIcon = selectedOption?.icon
      const visualLabel =
        overlayLabel ?? multiSelectLabel ?? (selectedOption ? selectedOption.label : placeholder)
      const isLoadingContinuation = isLoadingMore || isLoadingAll
      const resolvedEmptyMessage =
        truncated && hasActiveSearch
          ? 'No matches in partial results'
          : hasMore && hasActiveSearch
            ? 'No matches in loaded options'
            : hasMore
              ? 'No options loaded'
              : emptyMessage ||
                (searchQuery || (editable && value)
                  ? 'No matching options found'
                  : 'No options available')
      const continuationFooter =
        hasMore && continuationAction ? (
          <Button
            type='button'
            variant='ghost-secondary'
            size='sm'
            className='w-full'
            disabled={isLoadingContinuation}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              continuationAction()
            }}
          >
            {isLoadingContinuation && (
              <Loader className='mr-1.5 size-[14px] text-[var(--text-icon)]' animate />
            )}
            {isLoadingContinuation
              ? continuationLoadingLabel
              : error
                ? 'Try again'
                : continuationLabel}
          </Button>
        ) : truncated && filteredOptions.length > 0 ? (
          <div className='py-2 text-center text-[var(--text-muted)] text-caption'>
            Showing partial results
          </div>
        ) : null

      const renderFlatOption = (option: ComboboxOption, index: number) => {
        const isSelected = multiSelect
          ? multiSelectValues?.includes(option.value)
          : effectiveSelectedValue === option.value
        const isHighlighted = index === effectiveHighlightedIndex
        const OptionIcon = option.icon

        return (
          <div
            role='option'
            aria-selected={isSelected}
            aria-disabled={option.disabled}
            data-option-index={index}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (!option.disabled) {
                handleSelect(option.value, option.onSelect, option.keepOpen)
              }
            }}
            onMouseEnter={() => !option.disabled && setHighlightedIndex(index)}
            className={cn(
              'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-1.5 font-sans',
              size === 'sm' ? 'py-[5px] text-caption' : 'py-1.5 text-sm',
              (isHighlighted || isSelected) && chipActiveSurfaceClass,
              option.disabled && 'cursor-not-allowed opacity-50'
            )}
          >
            {option.iconElement
              ? option.iconElement
              : OptionIcon && <OptionIcon className='size-[14px] shrink-0' />}
            <OverflowText label={option.label} className='flex-1 text-[var(--text-primary)]' />
            {option.suffixElement}
            {multiSelect && isSelected && (
              <Check className='ml-2 size-[12px] shrink-0 text-[var(--text-primary)]' />
            )}
          </div>
        )
      }

      return (
        <Popover open={open} onOpenChange={changeOpen}>
          <div ref={containerRef} className='relative w-full' {...props}>
            <PopoverAnchor asChild>
              <div className='w-full'>
                {editable ? (
                  <div className='group relative'>
                    <Input
                      ref={inputRef}
                      className={cn(
                        'w-full pr-10 transition-colors',
                        (overlayContent || SelectedIcon) && 'text-transparent caret-foreground',
                        SelectedIcon && !overlayContent && 'pl-7',
                        open && 'focus-visible:border-[var(--border-1)]',
                        className
                      )}
                      placeholder={placeholder}
                      value={value ?? ''}
                      onChange={handleInputChange}
                      onFocus={handleFocus}
                      onBlur={handleBlur}
                      onKeyDown={handleKeyDown}
                      disabled={disabled}
                      {...inputProps}
                      role='combobox'
                      aria-expanded={open}
                      aria-haspopup='listbox'
                      aria-controls={listboxId}
                      aria-autocomplete='list'
                    />
                    {(overlayContent || SelectedIcon) && (
                      <div
                        className={cn(
                          'pointer-events-none absolute top-0 right-[42px] bottom-0 left-0 flex items-center bg-transparent px-2 py-1.5 font-sans text-sm',
                          disabled && 'opacity-50'
                        )}
                      >
                        {overlayContent ? (
                          overlayContent
                        ) : (
                          <>
                            {SelectedIcon && <SelectedIcon className='mr-2 size-3 shrink-0' />}
                            <OverflowText
                              label={selectedOption?.label ?? ''}
                              className='text-[var(--text-primary)]'
                            />
                          </>
                        )}
                      </div>
                    )}
                    <button
                      type='button'
                      aria-label={open ? 'Close options' : 'Open options'}
                      className='-translate-y-1/2 absolute top-1/2 right-[4px] z-10 flex size-6 cursor-pointer items-center justify-center border-0 bg-transparent p-0'
                      onMouseDown={handleChevronClick}
                    >
                      <ChevronDown
                        className={cn(
                          'size-4 opacity-50 transition-transform',
                          open && 'rotate-180'
                        )}
                      />
                    </button>
                  </div>
                ) : (
                  <div
                    ref={ref}
                    role='combobox'
                    aria-expanded={open}
                    aria-haspopup='listbox'
                    aria-controls={listboxId}
                    aria-disabled={disabled}
                    tabIndex={disabled ? -1 : 0}
                    className={cn(
                      comboboxVariants({ variant, size }),
                      'relative cursor-pointer items-center justify-between',
                      disabled && 'cursor-not-allowed opacity-50',
                      className
                    )}
                    onClick={handleToggle}
                    onKeyDown={handleKeyDown}
                  >
                    <OverflowText
                      label={visualLabel}
                      className={cn(
                        'flex-1',
                        !selectedOption && !multiSelectLabel && 'text-[var(--text-muted)]',
                        overlayContent && 'text-transparent'
                      )}
                    />
                    <ChevronDown
                      className={cn(
                        'ml-2 size-4 shrink-0 opacity-50 transition-transform',
                        open && 'rotate-180'
                      )}
                    />
                    {overlayContent && (
                      <div className='pointer-events-none absolute inset-y-0 right-[24px] left-0 flex items-center px-2'>
                        <OverflowText label={visualLabel} className='w-full' tooltipEnabled={false}>
                          {overlayContent}
                        </OverflowText>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </PopoverAnchor>

            <PopoverContent
              disablePortal={disablePortal}
              side='bottom'
              align={align}
              sideOffset={4}
              className={cn(
                'rounded-md border border-[var(--border-1)] p-0',
                dropdownWidth === 'trigger' && 'w-[var(--radix-popover-trigger-width)]'
              )}
              style={
                typeof dropdownWidth === 'number' ? { width: `${dropdownWidth}px` } : undefined
              }
              onOpenAutoFocus={(e) => {
                e.preventDefault()
                // Only auto-focus search input when not in editable mode
                if (searchable && !editable) {
                  setTimeout(() => searchInputRef.current?.focus(), 0)
                }
              }}
              onPointerDownCapture={() => {
                if (editable) pointerDownInsideRef.current = true
              }}
              onInteractOutside={(e) => {
                // If the user clicks the anchor/trigger while the popover is open,
                // prevent Radix from auto-closing on mousedown. Our own toggle handler
                // on the anchor will close it explicitly, avoiding close→reopen races.
                const target = e.target as Node
                if (containerRef.current?.contains(target)) {
                  e.preventDefault()
                }
              }}
            >
              {searchable && (
                <div className='flex items-center px-2.5 pt-2 pb-1'>
                  <Search className='mr-[7px] ml-[1px] size-[13px] shrink-0 text-[var(--text-muted)]' />
                  <input
                    ref={searchInputRef}
                    className='w-full bg-transparent text-[var(--text-primary)] text-small placeholder:text-[var(--text-muted)] focus:outline-hidden'
                    placeholder={searchPlaceholder}
                    value={searchQuery}
                    onChange={(e) => updateSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      // Forward navigation keys to main handler
                      // Only forward ArrowLeft/ArrowRight when cursor is at the boundary
                      // so normal text cursor movement still works in the search input
                      const input = e.currentTarget
                      const forwardArrowLeft = e.key === 'ArrowLeft' && input.selectionStart === 0
                      const forwardArrowRight =
                        e.key === 'ArrowRight' && input.selectionStart === input.value.length
                      if (
                        e.key === 'ArrowDown' ||
                        e.key === 'ArrowUp' ||
                        forwardArrowRight ||
                        forwardArrowLeft ||
                        e.key === 'Enter' ||
                        e.key === 'Escape'
                      ) {
                        handleKeyDown(e)
                      }
                    }}
                  />
                </div>
              )}
              <PopoverScrollArea
                ref={setScrollArea}
                className='flex-none! p-1'
                style={{ maxHeight: `${maxHeight}px` }}
                onScroll={(event) => {
                  if (hasActiveSearch || !hasMore || isLoadingContinuation || !onLoadMore) return
                  const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
                  if (scrollTop + clientHeight >= scrollHeight - 24) onLoadMore()
                }}
                onWheelCapture={(e) => {
                  const target = e.currentTarget
                  const { scrollTop, scrollHeight, clientHeight } = target
                  const delta = e.deltaY
                  const isScrollingDown = delta > 0
                  const isScrollingUp = delta < 0
                  const isAtTop = scrollTop === 0
                  const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1
                  if ((isScrollingDown && !isAtBottom) || (isScrollingUp && !isAtTop)) {
                    e.stopPropagation()
                  }
                }}
              >
                <div ref={dropdownRef} role='listbox' id={listboxId}>
                  {isLoading ? (
                    <div className='flex items-center justify-center py-3.5'>
                      <Loader className='size-[16px] text-[var(--text-muted)]' animate />
                      <span className='ml-2 text-[var(--text-muted)] text-caption'>
                        Loading options...
                      </span>
                    </div>
                  ) : error && filteredOptions.length === 0 && !hasMore ? (
                    <div className='px-1.5 py-3.5 text-center text-[var(--text-error)] text-caption'>
                      {error}
                    </div>
                  ) : filteredOptions.length === 0 ? (
                    <div className='py-3.5 text-center text-[var(--text-muted)] text-caption'>
                      {resolvedEmptyMessage}
                    </div>
                  ) : filteredGroups ? (
                    // Render grouped options with section headers
                    <div className='space-y-0.5'>
                      {filteredGroups.map((group, groupIndex) => (
                        <div key={group.section || `group-${groupIndex}`}>
                          {group.sectionElement
                            ? group.sectionElement
                            : group.section && (
                                <div className='px-1.5 py-1 text-[var(--text-tertiary)] text-xs first:pt-1'>
                                  {group.section}
                                </div>
                              )}
                          {group.items.map((option) => {
                            const isSelected = multiSelect
                              ? multiSelectValues?.includes(option.value)
                              : effectiveSelectedValue === option.value
                            const globalIndex = filteredOptions.findIndex(
                              (o) => o.value === option.value
                            )
                            const isHighlighted = globalIndex === effectiveHighlightedIndex
                            const OptionIcon = option.icon

                            return (
                              <div
                                key={option.value}
                                role='option'
                                aria-selected={isSelected}
                                aria-disabled={option.disabled}
                                data-option-index={globalIndex}
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  if (!option.disabled) {
                                    handleSelect(option.value, option.onSelect, option.keepOpen)
                                  }
                                }}
                                onMouseEnter={() =>
                                  !option.disabled && setHighlightedIndex(globalIndex)
                                }
                                className={cn(
                                  'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-1.5 font-sans',
                                  size === 'sm' ? 'py-[5px] text-caption' : 'py-1.5 text-sm',
                                  /*
                                     No CSS `:hover` here — `isHighlighted` is the
                                     single source of truth for the cursor, because
                                     it is also what Enter commits. A `:hover` class
                                     tracks the pointer continuously while
                                     `highlightedIndex` only moves on `mouseenter`,
                                     so after the list scrolls under a stationary
                                     pointer the two disagree and the row that looks
                                     selected is not the one Enter would choose.
                                  */
                                  (isHighlighted || isSelected) && chipActiveSurfaceClass,
                                  option.disabled && 'cursor-not-allowed opacity-50'
                                )}
                              >
                                {option.iconElement
                                  ? option.iconElement
                                  : OptionIcon && <OptionIcon className='size-[14px] shrink-0' />}
                                <OverflowText
                                  label={option.label}
                                  className='flex-1 text-[var(--text-primary)]'
                                />
                                {option.suffixElement}
                                {multiSelect && isSelected && (
                                  <Check className='ml-2 size-[12px] shrink-0 text-[var(--text-primary)]' />
                                )}
                              </div>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  ) : (
                    // Render flat options (no groups)
                    <div className='space-y-0.5'>
                      {showAllOption && multiSelect && (
                        <div
                          role='option'
                          aria-selected={!multiSelectValues?.length}
                          data-option-index={-1}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            onMultiSelectChange?.([])
                          }}
                          onMouseEnter={() => setHighlightedIndex(-1)}
                          className={cn(
                            'relative flex cursor-pointer select-none items-center rounded-sm px-1.5 font-sans',
                            size === 'sm' ? 'py-[5px] text-caption' : 'py-1.5 text-sm',
                            // Clears the highlight rather than taking it, so unlike option rows it hovers.
                            !multiSelectValues?.length
                              ? chipActiveSurfaceClass
                              : chipHoverSurfaceClass
                          )}
                        >
                          <OverflowText
                            label={allOptionLabel}
                            className='flex-1 text-[var(--text-primary)]'
                          />
                        </div>
                      )}
                      {virtualizeOptions ? (
                        <div
                          className='relative w-full'
                          style={{ height: `${optionVirtualizer.getTotalSize()}px` }}
                        >
                          {optionVirtualizer.getVirtualItems().map((virtualOption) => (
                            <div
                              key={filteredOptions[virtualOption.index].value}
                              ref={optionVirtualizer.measureElement}
                              data-index={virtualOption.index}
                              className='absolute top-0 left-0 w-full pb-0.5'
                              style={{ transform: `translateY(${virtualOption.start}px)` }}
                            >
                              {renderFlatOption(
                                filteredOptions[virtualOption.index],
                                virtualOption.index
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        filteredOptions.map((option, index) => (
                          <div key={option.value}>{renderFlatOption(option, index)}</div>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {continuationFooter}
              </PopoverScrollArea>
            </PopoverContent>
          </div>
        </Popover>
      )
    }
  )
)

Combobox.displayName = 'Combobox'

export { Combobox, comboboxVariants }
