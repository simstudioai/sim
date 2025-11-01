import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { Badge } from '@/components/emcn'
import { Input } from '@/components/emcn/components/input/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import { ResponseBlockHandler } from '@/executor/handlers/response/response-handler'

/**
 * Dropdown option type - can be a simple string or an object with label, id, and optional icon
 */
type DropdownOption =
  | string
  | { label: string; id: string; icon?: React.ComponentType<{ className?: string }> }

/**
 * Props for the Dropdown component
 */
interface DropdownProps {
  /** Static options array or function that returns options */
  options: DropdownOption[] | (() => DropdownOption[])
  /** Default value to select when no value is set */
  defaultValue?: string
  /** Unique identifier for the block */
  blockId: string
  /** Unique identifier for the sub-block */
  subBlockId: string
  /** Current value(s) - string for single select, array for multi-select */
  value?: string | string[]
  /** Whether component is in preview mode */
  isPreview?: boolean
  /** Value to display in preview mode */
  previewValue?: string | string[] | null
  /** Whether the dropdown is disabled */
  disabled?: boolean
  /** Placeholder text when no value is selected */
  placeholder?: string
  /** Enable multi-select mode */
  multiSelect?: boolean
  /** Async function to fetch options dynamically */
  fetchOptions?: (
    blockId: string,
    subBlockId: string
  ) => Promise<Array<{ label: string; id: string }>>
}

/**
 * Dropdown component with support for single/multi-select, async options, and data mode conversion
 *
 * @remarks
 * - Supports both static and dynamic (fetched) options
 * - Can operate in single-select or multi-select mode
 * - Special handling for dataMode subblock to convert between JSON and structured formats
 * - Integrates with the workflow state management system
 */
export function Dropdown({
  options,
  defaultValue,
  blockId,
  subBlockId,
  value: propValue,
  isPreview = false,
  previewValue,
  disabled,
  placeholder = 'Select an option...',
  multiSelect = false,
  fetchOptions,
}: DropdownProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string | string[]>(blockId, subBlockId) as [
    string | string[] | null | undefined,
    (value: string | string[]) => void,
  ]

  const [storeInitialized, setStoreInitialized] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [fetchedOptions, setFetchedOptions] = useState<Array<{ label: string; id: string }>>([])
  const [isLoadingOptions, setIsLoadingOptions] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const previousModeRef = useRef<string | null>(null)

  const [builderData, setBuilderData] = useSubBlockValue<any[]>(blockId, 'builderData')
  const [data, setData] = useSubBlockValue<string>(blockId, 'data')

  const builderDataRef = useRef(builderData)
  const dataRef = useRef(data)

  useEffect(() => {
    builderDataRef.current = builderData
    dataRef.current = data
  }, [builderData, data])

  const value = isPreview ? previewValue : propValue !== undefined ? propValue : storeValue

  const singleValue = multiSelect ? null : (value as string | null | undefined)
  const multiValues = multiSelect ? (value as string[] | null | undefined) || [] : null

  const fetchOptionsIfNeeded = useCallback(async () => {
    if (!fetchOptions || isPreview || disabled) return

    setIsLoadingOptions(true)
    setFetchError(null)
    try {
      const options = await fetchOptions(blockId, subBlockId)
      setFetchedOptions(options)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch options'
      setFetchError(errorMessage)
      setFetchedOptions([])
    } finally {
      setIsLoadingOptions(false)
    }
  }, [fetchOptions, blockId, subBlockId, isPreview, disabled])

  const evaluatedOptions = useMemo(() => {
    return typeof options === 'function' ? options() : options
  }, [options])

  const normalizedFetchedOptions = useMemo(() => {
    return fetchedOptions.map((opt) => ({ label: opt.label, id: opt.id }))
  }, [fetchedOptions])

  const availableOptions = useMemo(() => {
    if (fetchOptions && normalizedFetchedOptions.length > 0) {
      return normalizedFetchedOptions
    }
    return evaluatedOptions
  }, [fetchOptions, normalizedFetchedOptions, evaluatedOptions])

  const normalizedOptions = useMemo(() => {
    return availableOptions.map((opt) => {
      if (typeof opt === 'string') {
        return { id: opt, label: opt }
      }
      return { id: opt.id, label: opt.label }
    })
  }, [availableOptions])

  const optionMap = useMemo(() => {
    return new Map(normalizedOptions.map((opt) => [opt.id, opt.label]))
  }, [normalizedOptions])

  /**
   * Extracts the value identifier from an option
   * @param option - The option to extract value from
   * @returns The option's value identifier
   */
  const getOptionValue = useCallback((option: DropdownOption): string => {
    return typeof option === 'string' ? option : option.id
  }, [])

  /**
   * Extracts the label from an option
   * @param option - The option to extract label from
   * @returns The option's display label
   */
  const getOptionLabel = useCallback((option: DropdownOption): string => {
    return typeof option === 'string' ? option : option.label
  }, [])

  const defaultOptionValue = useMemo(() => {
    if (multiSelect) return undefined
    if (defaultValue !== undefined) {
      return defaultValue
    }

    if (availableOptions.length > 0) {
      const firstOption = availableOptions[0]
      return typeof firstOption === 'string' ? firstOption : firstOption.id
    }

    return undefined
  }, [defaultValue, availableOptions, multiSelect])

  useEffect(() => {
    setStoreInitialized(true)
  }, [])

  useEffect(() => {
    if (multiSelect || !storeInitialized || defaultOptionValue === undefined) {
      return
    }
    if (storeValue === null || storeValue === undefined || storeValue === '') {
      setStoreValue(defaultOptionValue)
    }
  }, [storeInitialized, storeValue, defaultOptionValue, setStoreValue, multiSelect])

  /**
   * Normalizes variable references in JSON strings by wrapping them in quotes
   * @param jsonString - The JSON string containing variable references
   * @returns Normalized JSON string with quoted variable references
   */
  const normalizeVariableReferences = (jsonString: string): string => {
    return jsonString.replace(/([^"]<[^>]+>)/g, '"$1"')
  }

  /**
   * Converts a JSON string to builder data format for structured editing
   * @param jsonString - The JSON string to convert
   * @returns Array of field objects with id, name, type, value, and collapsed properties
   */
  const convertJsonToBuilderData = (jsonString: string): any[] => {
    try {
      const normalizedJson = normalizeVariableReferences(jsonString)
      const parsed = JSON.parse(normalizedJson)

      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return Object.entries(parsed).map(([key, value]) => {
          const fieldType = inferType(value)
          const fieldValue =
            fieldType === 'object' || fieldType === 'array' ? JSON.stringify(value, null, 2) : value

          return {
            id: crypto.randomUUID(),
            name: key,
            type: fieldType,
            value: fieldValue,
            collapsed: false,
          }
        })
      }

      return []
    } catch (error) {
      return []
    }
  }

  /**
   * Infers the type of a value for builder data field configuration
   * @param value - The value to infer type from
   * @returns The inferred type as a string literal
   */
  const inferType = (value: any): 'string' | 'number' | 'boolean' | 'object' | 'array' => {
    if (typeof value === 'boolean') return 'boolean'
    if (typeof value === 'number') return 'number'
    if (Array.isArray(value)) return 'array'
    if (typeof value === 'object' && value !== null) return 'object'
    return 'string'
  }

  useEffect(() => {
    if (multiSelect || subBlockId !== 'dataMode' || isPreview || disabled) return

    const currentMode = storeValue as string
    const previousMode = previousModeRef.current

    if (previousMode !== null && previousMode !== currentMode) {
      if (currentMode === 'json' && previousMode === 'structured') {
        const currentBuilderData = builderDataRef.current
        if (
          currentBuilderData &&
          Array.isArray(currentBuilderData) &&
          currentBuilderData.length > 0
        ) {
          const jsonString = ResponseBlockHandler.convertBuilderDataToJsonString(currentBuilderData)
          setData(jsonString)
        }
      } else if (currentMode === 'structured' && previousMode === 'json') {
        const currentData = dataRef.current
        if (currentData && typeof currentData === 'string' && currentData.trim().length > 0) {
          const builderArray = convertJsonToBuilderData(currentData)
          setBuilderData(builderArray)
        }
      }
    }

    previousModeRef.current = currentMode
  }, [storeValue, subBlockId, isPreview, disabled, setData, setBuilderData, multiSelect])

  const handleSelect = useCallback(
    (selectedValue: string) => {
      if (!isPreview && !disabled) {
        if (multiSelect) {
          const currentValues = multiValues || []
          const newValues = currentValues.includes(selectedValue)
            ? currentValues.filter((v) => v !== selectedValue)
            : [...currentValues, selectedValue]
          setStoreValue(newValues)
        } else {
          setStoreValue(selectedValue)
          setOpen(false)
          setHighlightedIndex(-1)
          inputRef.current?.blur()
        }
      } else if (!multiSelect) {
        setOpen(false)
        setHighlightedIndex(-1)
        inputRef.current?.blur()
      }
    },
    [isPreview, disabled, multiSelect, multiValues, setStoreValue]
  )

  const handleDropdownClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!disabled) {
        const willOpen = !open
        setOpen(willOpen)
        if (willOpen) {
          inputRef.current?.focus()
          fetchOptionsIfNeeded()
        }
      }
    },
    [disabled, open, fetchOptionsIfNeeded]
  )

  const handleFocus = useCallback(() => {
    setOpen(true)
    setHighlightedIndex(-1)
    fetchOptionsIfNeeded()
  }, [fetchOptionsIfNeeded])

  const handleBlur = useCallback(() => {
    setTimeout(() => {
      const activeElement = document.activeElement
      if (!activeElement || !activeElement.closest('.absolute.top-full')) {
        setOpen(false)
        setHighlightedIndex(-1)
      }
    }, 150)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setHighlightedIndex(-1)
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (!open) {
          setOpen(true)
          setHighlightedIndex(0)
          fetchOptionsIfNeeded()
        } else {
          setHighlightedIndex((prev) => (prev < availableOptions.length - 1 ? prev + 1 : 0))
        }
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (open) {
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : availableOptions.length - 1))
        }
      }

      if (e.key === 'Enter' && open && highlightedIndex >= 0) {
        e.preventDefault()
        const selectedOption = availableOptions[highlightedIndex]
        if (selectedOption) {
          handleSelect(getOptionValue(selectedOption))
        }
      }
    },
    [open, availableOptions, highlightedIndex, fetchOptionsIfNeeded, handleSelect, getOptionValue]
  )

  useEffect(() => {
    setHighlightedIndex((prev) => {
      if (prev >= 0 && prev < availableOptions.length) {
        return prev
      }
      return -1
    })
  }, [availableOptions])

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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      if (
        inputRef.current &&
        !inputRef.current.contains(target) &&
        !target.closest('.absolute.top-full')
      ) {
        setOpen(false)
        setHighlightedIndex(-1)
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [open])

  const { displayValue, selectedOption, selectedLabel, SelectedIcon } = useMemo(() => {
    const display = singleValue?.toString() ?? ''
    const selected = availableOptions.find((opt) => {
      const optValue = typeof opt === 'string' ? opt : opt.id
      return optValue === singleValue
    })
    const label = selected ? getOptionLabel(selected) : display
    const icon =
      selected && typeof selected === 'object' && 'icon' in selected
        ? (selected.icon as React.ComponentType<{ className?: string }>)
        : null

    return {
      displayValue: display,
      selectedOption: selected,
      selectedLabel: label,
      SelectedIcon: icon,
    }
  }, [singleValue, availableOptions, getOptionLabel])

  const multiSelectDisplay = useMemo(() => {
    if (!multiValues || multiValues.length === 0) return null

    const optionsNotLoaded = fetchOptions && fetchedOptions.length === 0

    return (
      <div className='flex flex-wrap items-center gap-1'>
        {optionsNotLoaded ? (
          <Badge className='text-xs'>
            {multiValues.length} selected
          </Badge>
        ) : (
          <>
            {multiValues.slice(0, 2).map((selectedValue: string) => (
              <Badge key={selectedValue} className='text-xs'>
                {optionMap.get(selectedValue) || selectedValue}
              </Badge>
            ))}
            {multiValues.length > 2 && (
              <Badge className='text-xs'>
                +{multiValues.length - 2} more
              </Badge>
            )}
          </>
        )}
      </div>
    )
  }, [multiValues, fetchOptions, fetchedOptions.length, optionMap])

  return (
    <div className='relative w-full'>
      <div className='relative'>
        <Input
          ref={inputRef}
          className={cn(
            'w-full cursor-pointer overflow-hidden pr-10 text-foreground',
            SelectedIcon ? 'pl-8' : '',
            multiSelect && multiSelectDisplay ? 'py-1.5' : ''
          )}
          placeholder={multiSelect && multiSelectDisplay ? '' : placeholder}
          value={multiSelect ? '' : selectedLabel || ''}
          readOnly
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          autoComplete='off'
        />
        {/* Multi-select badges overlay */}
        {multiSelect && multiSelectDisplay && (
          <div className='pointer-events-none absolute top-0 bottom-0 left-0 flex items-center overflow-hidden bg-transparent pr-10 pl-3'>
            {multiSelectDisplay}
          </div>
        )}
        {/* Icon overlay */}
        {SelectedIcon && (
          <div className='pointer-events-none absolute top-0 bottom-0 left-0 flex items-center bg-transparent pl-3 text-sm'>
            <SelectedIcon className='h-3 w-3' />
          </div>
        )}
        {/* Chevron button */}
        <Button
          variant='ghost'
          size='sm'
          className='-translate-y-1/2 absolute top-1/2 right-1 z-10 h-6 w-6 p-0 hover:bg-transparent'
          disabled={disabled}
          onMouseDown={handleDropdownClick}
        >
          <ChevronDown
            className={cn('h-4 w-4 opacity-50 transition-transform', open && 'rotate-180')}
          />
        </Button>
      </div>

      {/* Dropdown */}
      {open && (
        <div className='absolute top-full left-0 z-[100] mt-1 w-full'>
          <div className='allow-scroll fade-in-0 zoom-in-95 animate-in rounded-md border bg-popover text-popover-foreground shadow-lg'>
            <div
              ref={dropdownRef}
              className='allow-scroll max-h-48 overflow-y-auto p-1'
              style={{ scrollbarWidth: 'thin' }}
            >
              {isLoadingOptions ? (
                <div className='flex items-center justify-center py-6'>
                  <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
                  <span className='ml-2 text-muted-foreground text-sm'>Loading options...</span>
                </div>
              ) : fetchError ? (
                <div className='px-2 py-6 text-center text-destructive text-sm'>{fetchError}</div>
              ) : availableOptions.length === 0 ? (
                <div className='py-6 text-center text-muted-foreground text-sm'>
                  No options available.
                </div>
              ) : (
                availableOptions.map((option, index) => {
                  const optionValue = getOptionValue(option)
                  const optionLabel = getOptionLabel(option)
                  const OptionIcon =
                    typeof option === 'object' && 'icon' in option
                      ? (option.icon as React.ComponentType<{ className?: string }>)
                      : null
                  const isSelected = multiSelect
                    ? multiValues?.includes(optionValue)
                    : singleValue === optionValue
                  const isHighlighted = index === highlightedIndex

                  return (
                    <div
                      key={optionValue}
                      data-option-index={index}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleSelect(optionValue)
                      }}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      className={cn(
                        'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                        isHighlighted && 'bg-accent text-accent-foreground'
                      )}
                    >
                      {OptionIcon && <OptionIcon className='mr-2 h-3 w-3' />}
                      <span className='flex-1 truncate'>{optionLabel}</span>
                      {isSelected && <Check className='ml-2 h-4 w-4 flex-shrink-0' />}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
