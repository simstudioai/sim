import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
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
  value?: string
  isPreview?: boolean
  previewValue?: string | null
  disabled?: boolean
  placeholder?: string
  config?: import('@/blocks/types').SubBlockConfig
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
  config,
}: DropdownProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  const [storeInitialized, setStoreInitialized] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const previousModeRef = useRef<string | null>(null)

  // For response dataMode conversion - get builderData and data sub-blocks
  const [builderData, setBuilderData] = useSubBlockValue<any[]>(blockId, 'builderData')
  const [data, setData] = useSubBlockValue<string>(blockId, 'data')

  // Keep refs with latest values to avoid stale closures
  const builderDataRef = useRef(builderData)
  const dataRef = useRef(data)

  useEffect(() => {
    builderDataRef.current = builderData
    dataRef.current = data
  }, [builderData, data])

  // Use preview value when in preview mode, otherwise use store value or prop value
  const value = isPreview ? previewValue : propValue !== undefined ? propValue : storeValue

  // Evaluate options if it's a function
  const evaluatedOptions = useMemo(() => {
    return typeof options === 'function' ? options() : options
  }, [options])

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

  // Get the default option value (first option or provided defaultValue)
  const defaultOptionValue = useMemo(() => {
    if (defaultValue !== undefined) {
      return defaultValue
    }

    if (evaluatedOptions.length > 0) {
      return getOptionValue(evaluatedOptions[0])
    }

    return undefined
  }, [defaultValue, evaluatedOptions, getOptionValue])

  // Mark store as initialized on first render
  useEffect(() => {
    setStoreInitialized(true)
  }, [])

  // Only set default value once the store is confirmed to be initialized
  // and we know the actual value is null/undefined (not just loading)
  useEffect(() => {
    if (
      storeInitialized &&
      (value === null || value === undefined) &&
      defaultOptionValue !== undefined
    ) {
      setStoreValue(defaultOptionValue)
    }
  }, [storeInitialized, value, defaultOptionValue, setStoreValue])

  // Helper function to normalize variable references in JSON strings
  const normalizeVariableReferences = (jsonString: string): string => {
    // Replace unquoted variable references with quoted ones
    // Pattern: <variable.name> -> "<variable.name>"
    return jsonString.replace(/([^"]<[^>]+>)/g, '"$1"')
  }

  // Helper function to convert JSON string to builder data format
  const convertJsonToBuilderData = (jsonString: string): any[] => {
    try {
      // Always normalize variable references first
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

  // Helper function to infer field type from value
  const inferType = (value: any): 'string' | 'number' | 'boolean' | 'object' | 'array' => {
    if (typeof value === 'boolean') return 'boolean'
    if (typeof value === 'number') return 'number'
    if (Array.isArray(value)) return 'array'
    if (typeof value === 'object' && value !== null) return 'object'
    return 'string'
  }

  // Handle data conversion when dataMode changes
  useEffect(() => {
    if (subBlockId !== 'dataMode' || isPreview || disabled) return

    const currentMode = storeValue
    const previousMode = previousModeRef.current

    // Only convert if the mode actually changed
    if (previousMode !== null && previousMode !== currentMode) {
      // Builder to Editor mode (structured → json)
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
      }
      // Editor to Builder mode (json → structured)
      else if (currentMode === 'structured' && previousMode === 'json') {
        const currentData = dataRef.current
        if (currentData && typeof currentData === 'string' && currentData.trim().length > 0) {
          const builderArray = convertJsonToBuilderData(currentData)
          setBuilderData(builderArray)
        }
      }
    }

    // Update the previous mode ref
    previousModeRef.current = currentMode
  }, [storeValue, subBlockId, isPreview, disabled, setData, setBuilderData])

  // Event handlers
  const handleSelect = (selectedValue: string) => {
    if (!isPreview && !disabled) {
      setStoreValue(selectedValue)
    }
    setOpen(false)
    setHighlightedIndex(-1)
    inputRef.current?.blur()
  }

  const handleDropdownClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) {
      setOpen(!open)
      if (!open) {
        inputRef.current?.focus()
      }
    }
  }

  const handleFocus = () => {
    setOpen(true)
    setHighlightedIndex(-1)
  }

  const handleBlur = () => {
    // Delay closing to allow dropdown selection
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
      } else {
        setHighlightedIndex((prev) => (prev < evaluatedOptions.length - 1 ? prev + 1 : 0))
      }
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (open) {
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : evaluatedOptions.length - 1))
      }
    }

    if (e.key === 'Enter' && open && highlightedIndex >= 0) {
      e.preventDefault()
      const selectedOption = evaluatedOptions[highlightedIndex]
      if (selectedOption) {
        handleSelect(getOptionValue(selectedOption))
      }
    }
  }

  // Effects
  useEffect(() => {
    setHighlightedIndex((prev) => {
      if (prev >= 0 && prev < evaluatedOptions.length) {
        return prev
      }
      return -1
    })
  }, [evaluatedOptions])

  // Scroll highlighted option into view
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

  // Display value
  const displayValue = value?.toString() ?? ''
  const selectedOption = evaluatedOptions.find((opt) => getOptionValue(opt) === value)
  const selectedLabel = selectedOption ? getOptionLabel(selectedOption) : displayValue
  const SelectedIcon =
    selectedOption && typeof selectedOption === 'object' && 'icon' in selectedOption
      ? (selectedOption.icon as React.ComponentType<{ className?: string }>)
      : null

  // Render component
  return (
    <div className='relative w-full'>
      <div className='relative'>
        <Input
          ref={inputRef}
          className={cn(
            'w-full cursor-pointer overflow-hidden pr-10 text-foreground',
            SelectedIcon ? 'pl-8' : ''
          )}
          placeholder={placeholder}
          value={selectedLabel || ''}
          readOnly
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          autoComplete='off'
        />
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
              {evaluatedOptions.length === 0 ? (
                <div className='py-6 text-center text-muted-foreground text-sm'>
                  No options available.
                </div>
              ) : (
                evaluatedOptions.map((option, index) => {
                  const optionValue = getOptionValue(option)
                  const optionLabel = getOptionLabel(option)
                  const OptionIcon =
                    typeof option === 'object' && 'icon' in option
                      ? (option.icon as React.ComponentType<{ className?: string }>)
                      : null
                  const isSelected = value === optionValue
                  const isHighlighted = index === highlightedIndex

                  return (
                    <div
                      key={optionValue}
                      data-option-index={index}
                      onClick={() => handleSelect(optionValue)}
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
