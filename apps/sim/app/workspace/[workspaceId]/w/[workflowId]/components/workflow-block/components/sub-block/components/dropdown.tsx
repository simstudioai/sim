import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { ResponseBlockHandler } from '@/executor/handlers/response/response-handler'

interface DropdownProps {
  options:
    | Array<
        string | { label: string; id: string; icon?: React.ComponentType<{ className?: string }> }
      >
    | (() => Array<
        string | { label: string; id: string; icon?: React.ComponentType<{ className?: string }> }
      >)
  defaultValue?: string
  blockId: string
  subBlockId: string
  value?: string | string[]
  isPreview?: boolean
  previewValue?: string | string[] | null
  disabled?: boolean
  placeholder?: string
  multiSelect?: boolean
  fetchOptions?: (
    blockId: string,
    subBlockId: string
  ) => Promise<Array<{ label: string; id: string }>>
}

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
  const hasAttemptedFetchRef = useRef(false)

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

  const getOptionValue = (
    option:
      | string
      | { label: string; id: string; icon?: React.ComponentType<{ className?: string }> }
  ) => {
    return typeof option === 'string' ? option : option.id
  }

  const getOptionLabel = (
    option:
      | string
      | { label: string; id: string; icon?: React.ComponentType<{ className?: string }> }
  ) => {
    return typeof option === 'string' ? option : option.label
  }

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

  useEffect(() => {
    if (
      !fetchOptions ||
      fetchedOptions.length > 0 ||
      !storeInitialized ||
      hasAttemptedFetchRef.current
    ) {
      return
    }

    const hasSelectedValue = multiSelect
      ? Array.isArray(storeValue) && storeValue.length > 0
      : typeof storeValue === 'string' && storeValue !== ''

    if (hasSelectedValue) {
      hasAttemptedFetchRef.current = true
      fetchOptionsIfNeeded()
    }
  }, [
    fetchOptions,
    fetchedOptions.length,
    storeInitialized,
    storeValue,
    multiSelect,
    fetchOptionsIfNeeded,
  ])

  const normalizeVariableReferences = (jsonString: string): string => {
    return jsonString.replace(/([^"]<[^>]+>)/g, '"$1"')
  }

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

  const handleSelect = (selectedValue: string) => {
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
  }

  const handleDropdownClick = (e: React.MouseEvent) => {
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
  }

  const handleFocus = () => {
    setOpen(true)
    setHighlightedIndex(-1)
    fetchOptionsIfNeeded()
  }

  const handleBlur = () => {
    setTimeout(() => {
      const activeElement = document.activeElement
      if (!activeElement || !activeElement.closest('.absolute.top-full')) {
        setOpen(false)
        setHighlightedIndex(-1)
      }
    }, 150)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
  }

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

  const displayValue = singleValue?.toString() ?? ''
  const selectedOption = availableOptions.find((opt) => {
    const optValue = typeof opt === 'string' ? opt : opt.id
    return optValue === singleValue
  })
  const selectedLabel = selectedOption ? getOptionLabel(selectedOption) : displayValue
  const SelectedIcon =
    selectedOption && typeof selectedOption === 'object' && 'icon' in selectedOption
      ? (selectedOption.icon as React.ComponentType<{ className?: string }>)
      : null

  const multiSelectDisplay =
    multiValues && multiValues.length > 0 ? (
      <div className='flex flex-wrap items-center gap-1'>
        {multiValues.slice(0, 2).map((selectedValue: string) => (
          <Badge key={selectedValue} variant='secondary' className='text-xs'>
            {optionMap.get(selectedValue) || selectedValue}
          </Badge>
        ))}
        {multiValues.length > 2 && (
          <Badge variant='secondary' className='text-xs'>
            +{multiValues.length - 2} more
          </Badge>
        )}
      </div>
    ) : null

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
