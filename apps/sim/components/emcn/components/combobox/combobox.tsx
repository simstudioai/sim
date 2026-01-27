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
  useMemo,
  useRef,
  useState,
} from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Check, ChevronDown, Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'
import { Input } from '../input/input'
import { Popover, PopoverAnchor, PopoverContent, PopoverScrollArea } from '../popover/popover'

const comboboxVariants = cva(
  'flex w-full rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[8px] font-sans font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[var(--surface-7)] dark:hover:border-[var(--surface-7)] dark:hover:bg-[var(--border-1)]',
  {
    variants: {
      variant: {
        default: '',
      },
      size: {
        sm: 'py-[5px] text-[12px]',
        md: 'py-[6px] text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
)

/**
 * Represents a selectable option in the combobox
 */
export type ComboboxOption = {
  label: string
  value: string
  /** Icon component to render */
  icon?: React.ComponentType<{ className?: string }>
  /** Pre-rendered icon element (alternative to icon component) */
  iconElement?: ReactNode
  /** Custom select handler - when provided, this is called instead of onChange */
  onSelect?: () => void
  /** Whether this option is disabled */
  disabled?: boolean
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
  /** Custom overlay content for editable mode */
  overlayContent?: ReactNode
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
  /** Enable search input in dropdown (useful for multiselect) */
  searchable?: boolean
  /** Placeholder for search input */
  searchPlaceholder?: string
  /** Size variant */
  size?: 'sm' | 'md'
  /** Dropdown alignment */
  align?: 'start' | 'center' | 'end'
  /** Dropdown width - 'trigger' matches trigger width, or provide a pixel value */
  dropdownWidth?: 'trigger' | number
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
        inputProps = {},
        inputRef: externalInputRef,
        filterOptions = editable,
        selectedValue,
        multiSelect = false,
        isLoading = false,
        error = null,
        onOpenChange,
        searchable = false,
        searchPlaceholder = 'Search...',
        align = 'start',
        dropdownWidth = 'trigger',
        showAllOption = false,
        allOptionLabel = 'All',
        groups,
        maxHeight = 192,
        emptyMessage,
        ...props
      },
      ref
    ) => {
      const [open, setOpen] = useState(false)
      const [highlightedIndex, setHighlightedIndex] = useState(-1)
      const [searchQuery, setSearchQuery] = useState('')
      const searchInputRef = useRef<HTMLInputElement>(null)
      const containerRef = useRef<HTMLDivElement>(null)
      const dropdownRef = useRef<HTMLDivElement>(null)
      const internalInputRef = useRef<HTMLInputElement>(null)
      const inputRef = externalInputRef || internalInputRef

      const effectiveSelectedValue = selectedValue ?? value

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
       * Filter options based on current value or search query
       */
      const filteredOptions = useMemo(() => {
        let result = allOptions

        // Filter by editable input value
        if (filterOptions && value && open) {
          const currentValue = value.toString().toLowerCase()
          const exactMatch = allOptions.find(
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

        // Filter by search query (for searchable mode)
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
        if (!searchable || !searchQuery) return groups

        const query = searchQuery.toLowerCase()
        return groups
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

      /**
       * Handles selection of an option
       */
      const handleSelect = useCallback(
        (selectedValue: string, customOnSelect?: () => void) => {
          // If option has custom onSelect, use it instead
          if (customOnSelect) {
            customOnSelect()
            setOpen(false)
            setHighlightedIndex(-1)
            setSearchQuery('')
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
            setOpen(false)
            setHighlightedIndex(-1)
            setSearchQuery('')
            if (editable && inputRef.current) {
              inputRef.current.blur()
            }
          }
        },
        [onChange, multiSelect, onMultiSelectChange, multiSelectValues, editable, inputRef]
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
          setOpen(true)
          setHighlightedIndex(-1)
        }
      }, [disabled])

      /**
       * Handles blur for editable mode
       */
      const handleBlur = useCallback(() => {
        // Delay to allow dropdown clicks
        setTimeout(() => {
          const activeElement = document.activeElement
          // Check if focus is in the container, dropdown, or search input
          const isInContainer = containerRef.current?.contains(activeElement)
          const isInDropdown = dropdownRef.current?.contains(activeElement)
          const isSearchInput = activeElement === searchInputRef.current
          if (!activeElement || (!isInContainer && !isInDropdown && !isSearchInput)) {
            setOpen(false)
            setHighlightedIndex(-1)
            setSearchQuery('')
          }
        }, 150)
      }, [])

      /**
       * Handles keyboard navigation
       */
      const handleKeyDown = useCallback(
        (e: KeyboardEvent<HTMLDivElement | HTMLInputElement>) => {
          if (disabled) return

          if (e.key === 'Escape') {
            setOpen(false)
            setHighlightedIndex(-1)
            setSearchQuery('')
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
                handleSelect(selectedOption.value, selectedOption.onSelect)
              }
            } else if (!editable) {
              e.preventDefault()
              setOpen(true)
              setHighlightedIndex(0)
            }
            return
          }

          if (e.key === ' ' && !editable) {
            e.preventDefault()
            if (!open) {
              setOpen(true)
              setHighlightedIndex(0)
            }
            return
          }

          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (!open) {
              setOpen(true)
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
        },
        [disabled, open, highlightedIndex, filteredOptions, handleSelect, editable, inputRef]
      )

      /**
       * Handles toggle of dropdown (for select mode only)
       */
      const handleToggle = useCallback(() => {
        if (!disabled && !editable) {
          setOpen((prev) => !prev)
          setHighlightedIndex(-1)
        }
      }, [disabled, editable])

      /**
       * Handles chevron click for editable mode
       */
      const handleChevronClick = useCallback(
        (e: React.MouseEvent) => {
          e.preventDefault()
          e.stopPropagation()
          if (!disabled) {
            setOpen((prev) => {
              const newOpen = !prev
              if (newOpen && editable && inputRef.current) {
                inputRef.current.focus()
              }
              return newOpen
            })
          }
        },
        [disabled, editable, inputRef]
      )

      /**
       * Scroll highlighted option into view
       */
      useEffect(() => {
        if (highlightedIndex >= 0 && dropdownRef.current) {
          const highlightedElement = dropdownRef.current.querySelector(
            `[data-option-index="${highlightedIndex}"]`
          )
          if (highlightedElement) {
            highlightedElement.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest',
            })
          }
        }
      }, [highlightedIndex])

      /**
       * Adjust highlighted index when filtered options change
       */
      useEffect(() => {
        setHighlightedIndex((prev) => {
          if (prev >= 0 && prev < filteredOptions.length) {
            return prev
          }
          return -1
        })
      }, [filteredOptions])

      const SelectedIcon = selectedOption?.icon

      return (
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (!next) setSearchQuery('')
            onOpenChange?.(next)
          }}
        >
          <div ref={containerRef} className='relative w-full' {...props}>
            <PopoverAnchor asChild>
              <div className='w-full'>
                {editable ? (
                  <div className='group relative'>
                    <Input
                      ref={inputRef}
                      className={cn(
                        'w-full pr-[40px] font-medium transition-colors hover:bg-[var(--surface-7)] dark:hover:border-[var(--surface-7)] dark:hover:bg-[var(--border-1)]',
                        (overlayContent || SelectedIcon) && 'text-transparent caret-foreground',
                        SelectedIcon && !overlayContent && 'pl-[28px]',
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
                    />
                    {(overlayContent || SelectedIcon) && (
                      <div
                        className={cn(
                          'pointer-events-none absolute top-0 right-[42px] bottom-0 left-0 flex items-center bg-transparent px-[8px] py-[6px] font-medium font-sans text-sm',
                          disabled && 'opacity-50'
                        )}
                      >
                        {overlayContent ? (
                          overlayContent
                        ) : (
                          <>
                            {SelectedIcon && (
                              <SelectedIcon className='mr-[8px] h-3 w-3 flex-shrink-0' />
                            )}
                            <span className='truncate text-[var(--text-primary)]'>
                              {selectedOption?.label}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                    <div
                      className='-translate-y-1/2 absolute top-1/2 right-[4px] z-10 flex h-6 w-6 cursor-pointer items-center justify-center'
                      onMouseDown={handleChevronClick}
                    >
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 opacity-50 transition-transform',
                          open && 'rotate-180'
                        )}
                      />
                    </div>
                  </div>
                ) : (
                  <div
                    ref={ref}
                    role='combobox'
                    aria-expanded={open}
                    aria-haspopup='listbox'
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
                    <span
                      className={cn(
                        'flex-1 truncate',
                        !selectedOption && 'text-[var(--text-muted)]',
                        overlayContent && 'text-transparent'
                      )}
                    >
                      {selectedOption ? selectedOption.label : placeholder}
                    </span>
                    <ChevronDown
                      className={cn(
                        'ml-[8px] h-4 w-4 flex-shrink-0 opacity-50 transition-transform',
                        open && 'rotate-180'
                      )}
                    />
                    {overlayContent && (
                      <div className='pointer-events-none absolute inset-y-0 right-[24px] left-0 flex items-center px-[8px]'>
                        <div className='w-full truncate'>{overlayContent}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </PopoverAnchor>

            <PopoverContent
              side='bottom'
              align={align}
              sideOffset={4}
              className={cn(
                'rounded-[6px] border border-[var(--border-1)] p-0',
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
                <div className='flex items-center px-[10px] pt-[8px] pb-[4px]'>
                  <Search className='mr-[7px] ml-[1px] h-[13px] w-[13px] shrink-0 text-[var(--text-muted)]' />
                  <input
                    ref={searchInputRef}
                    className='w-full bg-transparent font-base text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none'
                    placeholder={searchPlaceholder}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      // Forward navigation keys to main handler
                      if (
                        e.key === 'ArrowDown' ||
                        e.key === 'ArrowUp' ||
                        e.key === 'Enter' ||
                        e.key === 'Escape'
                      ) {
                        handleKeyDown(e as unknown as KeyboardEvent<HTMLDivElement>)
                      }
                    }}
                  />
                </div>
              )}
              <PopoverScrollArea
                className='!flex-none p-[4px]'
                style={{ maxHeight: `${maxHeight}px` }}
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
                <div ref={dropdownRef} role='listbox'>
                  {isLoading ? (
                    <div className='flex items-center justify-center py-[14px]'>
                      <Loader2 className='h-[16px] w-[16px] animate-spin text-[var(--text-muted)]' />
                      <span className='ml-[8px] font-base text-[12px] text-[var(--text-muted)]'>
                        Loading options...
                      </span>
                    </div>
                  ) : error ? (
                    <div className='px-[6px] py-[14px] text-center font-base text-[12px] text-red-500'>
                      {error}
                    </div>
                  ) : filteredOptions.length === 0 ? (
                    <div className='py-[14px] text-center font-base text-[12px] text-[var(--text-muted)]'>
                      {emptyMessage ||
                        (searchQuery || (editable && value)
                          ? 'No matching options found'
                          : 'No options available')}
                    </div>
                  ) : filteredGroups ? (
                    // Render grouped options with section headers
                    <div className='space-y-[2px]'>
                      {filteredGroups.map((group, groupIndex) => (
                        <div key={group.section || `group-${groupIndex}`}>
                          {group.sectionElement
                            ? group.sectionElement
                            : group.section && (
                                <div className='px-[6px] py-[4px] font-base text-[11px] text-[var(--text-tertiary)] first:pt-[4px]'>
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
                            const isHighlighted = globalIndex === highlightedIndex
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
                                    handleSelect(option.value, option.onSelect)
                                  }
                                }}
                                onMouseEnter={() =>
                                  !option.disabled && setHighlightedIndex(globalIndex)
                                }
                                className={cn(
                                  'relative flex cursor-pointer select-none items-center gap-[8px] rounded-[4px] px-[6px] font-medium font-sans',
                                  size === 'sm' ? 'py-[5px] text-[12px]' : 'py-[6px] text-sm',
                                  'hover:bg-[var(--border-1)]',
                                  (isHighlighted || isSelected) && 'bg-[var(--border-1)]',
                                  option.disabled && 'cursor-not-allowed opacity-50'
                                )}
                              >
                                {option.iconElement
                                  ? option.iconElement
                                  : OptionIcon && (
                                      <OptionIcon className='h-[14px] w-[14px] flex-shrink-0' />
                                    )}
                                <span className='flex-1 truncate text-[var(--text-primary)]'>
                                  {option.label}
                                </span>
                                {multiSelect && isSelected && (
                                  <Check className='ml-[8px] h-[12px] w-[12px] flex-shrink-0 text-[var(--text-primary)]' />
                                )}
                              </div>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  ) : (
                    // Render flat options (no groups)
                    <div className='space-y-[2px]'>
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
                            'relative flex cursor-pointer select-none items-center rounded-[4px] px-[6px] font-medium font-sans',
                            size === 'sm' ? 'py-[5px] text-[12px]' : 'py-[6px] text-sm',
                            'hover:bg-[var(--border-1)]',
                            !multiSelectValues?.length && 'bg-[var(--border-1)]'
                          )}
                        >
                          <span className='flex-1 truncate text-[var(--text-primary)]'>
                            {allOptionLabel}
                          </span>
                        </div>
                      )}
                      {filteredOptions.map((option, index) => {
                        const isSelected = multiSelect
                          ? multiSelectValues?.includes(option.value)
                          : effectiveSelectedValue === option.value
                        const isHighlighted = index === highlightedIndex
                        const OptionIcon = option.icon

                        return (
                          <div
                            key={option.value}
                            role='option'
                            aria-selected={isSelected}
                            aria-disabled={option.disabled}
                            data-option-index={index}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              if (!option.disabled) {
                                handleSelect(option.value, option.onSelect)
                              }
                            }}
                            onMouseEnter={() => !option.disabled && setHighlightedIndex(index)}
                            className={cn(
                              'relative flex cursor-pointer select-none items-center gap-[8px] rounded-[4px] px-[6px] font-medium font-sans',
                              size === 'sm' ? 'py-[5px] text-[12px]' : 'py-[6px] text-sm',
                              'hover:bg-[var(--border-1)]',
                              (isHighlighted || isSelected) && 'bg-[var(--border-1)]',
                              option.disabled && 'cursor-not-allowed opacity-50'
                            )}
                          >
                            {option.iconElement
                              ? option.iconElement
                              : OptionIcon && (
                                  <OptionIcon className='h-[14px] w-[14px] flex-shrink-0' />
                                )}
                            <span className='flex-1 truncate text-[var(--text-primary)]'>
                              {option.label}
                            </span>
                            {multiSelect && isSelected && (
                              <Check className='ml-[8px] h-[12px] w-[12px] flex-shrink-0 text-[var(--text-primary)]' />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
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
