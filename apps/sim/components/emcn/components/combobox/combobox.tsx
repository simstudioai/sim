import {
  type ChangeEvent,
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '../input/input'
import { Popover, PopoverAnchor, PopoverContent, PopoverScrollArea } from '../popover/popover'

const comboboxVariants = cva(
  'flex w-full rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] dark:bg-[var(--surface-9)] px-[8px] py-[6px] font-sans font-medium text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] dark:placeholder:text-[var(--text-muted)] outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 hover:border-[var(--surface-14)] hover:bg-[var(--surface-9)] dark:hover:border-[var(--surface-13)] dark:hover:bg-[var(--surface-11)]',
  {
    variants: {
      variant: {
        default: '',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

/**
 * Represents a selectable option in the combobox
 */
export type ComboboxOption = {
  label: string
  value: string
  icon?: React.ComponentType<{ className?: string }>
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
  /** Enable multi-select mode */
  multiSelect?: boolean
  /** Loading state */
  isLoading?: boolean
  /** Error message to display */
  error?: string | null
  /** Callback when popover open state changes */
  onOpenChange?: (open: boolean) => void
}

/**
 * Minimal combobox component matching the input and textarea styling.
 * Provides a dropdown selection interface with keyboard navigation support.
 * Supports both select-only and editable (free-text) modes.
 */
const Combobox = forwardRef<HTMLDivElement, ComboboxProps>(
  (
    {
      className,
      variant,
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
      multiSelect = false,
      isLoading = false,
      error = null,
      onOpenChange,
      ...props
    },
    ref
  ) => {
    const [open, setOpen] = useState(false)
    const [highlightedIndex, setHighlightedIndex] = useState(-1)
    const containerRef = useRef<HTMLDivElement>(null)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const internalInputRef = useRef<HTMLInputElement>(null)
    const inputRef = externalInputRef || internalInputRef

    const selectedOption = useMemo(
      () => options.find((opt) => opt.value === value),
      [options, value]
    )

    /**
     * Filter options based on current value
     */
    const filteredOptions = useMemo(() => {
      if (!filterOptions || !value || !open) return options

      const currentValue = value.toString().toLowerCase()

      // If value exactly matches an option, show all
      const exactMatch = options.find(
        (opt) => opt.value === value || opt.label.toLowerCase() === currentValue
      )
      if (exactMatch) return options

      // Filter options
      return options.filter((option) => {
        const label = option.label.toLowerCase()
        const optionValue = option.value.toLowerCase()
        return label.includes(currentValue) || optionValue.includes(currentValue)
      })
    }, [options, value, open, filterOptions])

    /**
     * Handles selection of an option
     */
    const handleSelect = useCallback(
      (selectedValue: string) => {
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
        if (!activeElement || !containerRef.current?.contains(activeElement)) {
          setOpen(false)
          setHighlightedIndex(-1)
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
          if (editable && inputRef.current) {
            inputRef.current.blur()
          }
          return
        }

        if (e.key === 'Enter') {
          if (open && highlightedIndex >= 0) {
            e.preventDefault()
            const selectedOption = filteredOptions[highlightedIndex]
            if (selectedOption) {
              handleSelect(selectedOption.value)
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
                      'w-full pr-[40px] font-medium transition-colors hover:border-[var(--surface-14)] hover:bg-[var(--surface-9)] dark:hover:border-[var(--surface-13)] dark:hover:bg-[var(--surface-11)]',
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
                    <div className='pointer-events-none absolute top-0 right-[42px] bottom-0 left-0 flex items-center bg-transparent px-[8px] py-[6px] font-medium font-sans text-sm'>
                      {overlayContent ? (
                        overlayContent
                      ) : (
                        <>
                          {SelectedIcon && (
                            <SelectedIcon className='mr-[8px] h-3 w-3 flex-shrink-0 opacity-60' />
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
                    comboboxVariants({ variant }),
                    'relative cursor-pointer items-center justify-between',
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
            align='start'
            sideOffset={4}
            className='w-[var(--radix-popover-trigger-width)] rounded-[4px] p-0'
            onOpenAutoFocus={(e) => {
              e.preventDefault()
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
            <PopoverScrollArea className='max-h-48 p-[4px]'>
              <div ref={dropdownRef} role='listbox'>
                {isLoading ? (
                  <div className='flex items-center justify-center py-[14px]'>
                    <Loader2 className='h-[16px] w-[16px] animate-spin text-[var(--text-muted)]' />
                    <span className='ml-[8px] font-medium font-sans text-[var(--text-muted)] text-sm'>
                      Loading options...
                    </span>
                  </div>
                ) : error ? (
                  <div className='px-[8px] py-[14px] text-center font-medium font-sans text-red-500 text-sm'>
                    {error}
                  </div>
                ) : filteredOptions.length === 0 ? (
                  <div className='py-[14px] text-center font-medium font-sans text-[var(--text-muted)] text-sm'>
                    {editable && value ? 'No matching options found' : 'No options available'}
                  </div>
                ) : (
                  filteredOptions.map((option, index) => {
                    const isSelected = multiSelect
                      ? multiSelectValues?.includes(option.value)
                      : value === option.value
                    const isHighlighted = index === highlightedIndex
                    const OptionIcon = option.icon

                    return (
                      <div
                        key={option.value}
                        role='option'
                        aria-selected={isSelected}
                        data-option-index={index}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleSelect(option.value)
                        }}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        className={cn(
                          'relative flex cursor-pointer select-none items-center rounded-[4px] px-[8px] py-[6px] font-medium font-sans text-sm',
                          isHighlighted && 'bg-[var(--surface-11)]',
                          !isHighlighted && 'hover:bg-[var(--surface-11)]'
                        )}
                      >
                        {OptionIcon && <OptionIcon className='mr-[8px] h-3 w-3 opacity-60' />}
                        <span className='flex-1 truncate text-[var(--text-primary)]'>
                          {option.label}
                        </span>
                        {isSelected && <Check className='ml-[8px] h-4 w-4 flex-shrink-0' />}
                      </div>
                    )
                  })
                )}
              </div>
            </PopoverScrollArea>
          </PopoverContent>
        </div>
      </Popover>
    )
  }
)

Combobox.displayName = 'Combobox'

export { Combobox, comboboxVariants }
