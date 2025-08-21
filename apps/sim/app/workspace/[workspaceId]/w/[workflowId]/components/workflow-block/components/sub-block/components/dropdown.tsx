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

  // For response dataMode conversion - get builderData and data sub-blocks
  const [builderData] = useSubBlockValue<any[]>(blockId, 'builderData')
  const [, setData] = useSubBlockValue<string>(blockId, 'data')

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

  // Event handlers
  const handleSelect = (selectedValue: string) => {
    if (!isPreview && !disabled) {
      // Handle conversion when switching from Builder to Editor mode in response blocks
      if (
        subBlockId === 'dataMode' &&
        storeValue === 'structured' &&
        selectedValue === 'json' &&
        builderData &&
        Array.isArray(builderData) &&
        builderData.length > 0
      ) {
        // Convert builderData to JSON string for editor mode
        const jsonString = ResponseBlockHandler.convertBuilderDataToJsonString(builderData)
        setData(jsonString)
      }

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
