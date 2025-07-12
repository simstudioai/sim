import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useReactFlow } from 'reactflow'
import { Button } from '@/components/ui/button'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { Input } from '@/components/ui/input'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import type { SubBlockConfig } from '@/blocks/types'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

const logger = createLogger('ComboBox')

interface ComboBoxProps {
  options:
    | Array<string | { label: string; id: string }>
    | (() => Array<string | { label: string; id: string }>)
  defaultValue?: string
  blockId: string
  subBlockId: string
  value?: string
  isPreview?: boolean
  previewValue?: string | null
  disabled?: boolean
  placeholder?: string
  isConnecting: boolean
  config: SubBlockConfig
}

export function ComboBox({
  options,
  defaultValue,
  blockId,
  subBlockId,
  value: propValue,
  isPreview = false,
  previewValue,
  disabled,
  placeholder = 'Type or select an option...',
  isConnecting,
  config,
}: ComboBoxProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  const [storeInitialized, setStoreInitialized] = useState(false)
  const [open, setOpen] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const reactFlowInstance = useReactFlow()

  // Use preview value when in preview mode, otherwise use store value or prop value
  const value = isPreview ? previewValue : propValue !== undefined ? propValue : storeValue

  // Evaluate options if it's a function
  const evaluatedOptions = useMemo(() => {
    return typeof options === 'function' ? options() : options
  }, [options])

  const getOptionValue = (option: string | { label: string; id: string }) => {
    return typeof option === 'string' ? option : option.id
  }

  const getOptionLabel = (option: string | { label: string; id: string }) => {
    return typeof option === 'string' ? option : option.label
  }

  // Get the default option value (prefer gpt-4o, then provided defaultValue, then first option)
  const defaultOptionValue = useMemo(() => {
    if (defaultValue !== undefined) {
      return defaultValue
    }

    // For model field, default to gpt-4o if available
    if (subBlockId === 'model') {
      const gpt4o = evaluatedOptions.find((opt) => getOptionValue(opt) === 'gpt-4o')
      if (gpt4o) {
        return getOptionValue(gpt4o)
      }
    }

    if (evaluatedOptions.length > 0) {
      return getOptionValue(evaluatedOptions[0])
    }

    return undefined
  }, [defaultValue, evaluatedOptions, getOptionValue, subBlockId])

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

  // Filter options based on current value for display
  const filteredOptions = useMemo(() => {
    // Always show all options when dropdown is not open
    if (!open) return evaluatedOptions

    // If no value or value matches an exact option, show all options
    if (!value) return evaluatedOptions

    const currentValue = value.toString()
    const exactMatch = evaluatedOptions.find(
      (opt) => getOptionValue(opt) === currentValue || getOptionLabel(opt) === currentValue
    )

    // If current value exactly matches an option, show all options (user just selected it)
    if (exactMatch) return evaluatedOptions

    // Otherwise filter based on current input
    return evaluatedOptions.filter((option) => {
      const label = getOptionLabel(option).toLowerCase()
      const optionValue = getOptionValue(option).toLowerCase()
      const search = currentValue.toLowerCase()
      return label.includes(search) || optionValue.includes(search)
    })
  }, [evaluatedOptions, value, open, getOptionLabel, getOptionValue])

  // Event handlers
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) {
      e.preventDefault()
      return
    }

    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart ?? 0

    // Update store value immediately (allow free text)
    if (!isPreview) {
      setStoreValue(newValue)
    }

    setCursorPosition(newCursorPosition)

    // Check for environment variables trigger
    const envVarTrigger = checkEnvVarTrigger(newValue, newCursorPosition)
    setShowEnvVars(envVarTrigger.show)
    setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')

    // Check for tag trigger
    const tagTrigger = checkTagTrigger(newValue, newCursorPosition)
    setShowTags(tagTrigger.show)
  }

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
    setIsFocused(true)
    setOpen(true)
    setHighlightedIndex(-1)
  }

  const handleBlur = () => {
    setIsFocused(false)
    setShowEnvVars(false)
    setShowTags(false)

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
      setShowEnvVars(false)
      setShowTags(false)
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
        setHighlightedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0))
      }
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (open) {
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1))
      }
    }

    if (e.key === 'Enter' && open && highlightedIndex >= 0) {
      e.preventDefault()
      const selectedOption = filteredOptions[highlightedIndex]
      if (selectedOption) {
        handleSelect(getOptionValue(selectedOption))
      }
    }
  }

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLInputElement>) => {
    if (config?.connectionDroppable === false) return
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent<HTMLInputElement>) => {
    if (config?.connectionDroppable === false) return
    e.preventDefault()

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type !== 'connectionBlock') return

      const dropPosition = inputRef.current?.selectionStart ?? value?.toString().length ?? 0
      const currentValue = value?.toString() ?? ''
      const newValue = `${currentValue.slice(0, dropPosition)}<${currentValue.slice(dropPosition)}`

      inputRef.current?.focus()

      Promise.resolve().then(() => {
        setStoreValue(newValue)
        setCursorPosition(dropPosition + 1)
        setShowTags(true)

        if (data.connectionData?.sourceBlockId) {
          setActiveSourceBlockId(data.connectionData.sourceBlockId)
        }

        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.selectionStart = dropPosition + 1
            inputRef.current.selectionEnd = dropPosition + 1
          }
        }, 0)
      })
    } catch (error) {
      logger.error('Failed to parse drop data:', { error })
    }
  }

  // Scroll and paste handlers
  const handleScroll = (e: React.UIEvent<HTMLInputElement>) => {
    if (overlayRef.current) {
      overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    setTimeout(() => {
      if (inputRef.current && overlayRef.current) {
        overlayRef.current.scrollLeft = inputRef.current.scrollLeft
      }
    }, 0)
  }

  // ReactFlow zoom handler
  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      e.stopPropagation()

      const currentZoom = reactFlowInstance.getZoom()
      const { x: viewportX, y: viewportY } = reactFlowInstance.getViewport()

      const delta = e.deltaY > 0 ? 1 : -1
      const zoomFactor = 0.96 ** delta
      const newZoom = Math.min(Math.max(currentZoom * zoomFactor, 0.1), 1)

      const { x: pointerX, y: pointerY } = reactFlowInstance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      })

      const newViewportX = viewportX + (pointerX * currentZoom - pointerX * newZoom)
      const newViewportY = viewportY + (pointerY * currentZoom - pointerY * newZoom)

      reactFlowInstance.setViewport(
        { x: newViewportX, y: newViewportY, zoom: newZoom },
        { duration: 0 }
      )

      return false
    }
    return true
  }

  // Environment variable and tag selection handler
  const handleEnvVarSelect = (newValue: string) => {
    if (!isPreview) {
      setStoreValue(newValue)
    }
  }

  // Effects
  useEffect(() => {
    if (inputRef.current && overlayRef.current) {
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft
    }
  }, [value])

  // Reset highlighted index when filtered options change, but preserve if within bounds
  useEffect(() => {
    setHighlightedIndex((prev) => {
      if (prev >= 0 && prev < filteredOptions.length) {
        return prev
      }
      return -1
    })
  }, [filteredOptions])

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
        !target.closest('[data-radix-popper-content-wrapper]') &&
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

  // Display value with formatting
  const displayValue = value?.toString() ?? ''

  // Render component
  return (
    <div className='relative w-full'>
      <div className='relative'>
        <Input
          ref={inputRef}
          className={cn(
            'allow-scroll w-full overflow-auto pr-10 text-transparent caret-foreground placeholder:text-muted-foreground/50',
            isConnecting &&
              config?.connectionDroppable !== false &&
              'ring-2 ring-blue-500 ring-offset-2 focus-visible:ring-blue-500'
          )}
          placeholder={placeholder}
          value={displayValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onScroll={handleScroll}
          onPaste={handlePaste}
          onWheel={handleWheel}
          disabled={disabled}
          autoComplete='off'
          style={{ overflowX: 'auto' }}
        />
        <div
          ref={overlayRef}
          className='pointer-events-none absolute top-0 bottom-0 left-0 flex items-center bg-transparent pr-0 pl-3 text-sm'
          style={{ right: '42px' }}
        >
          <div className='w-full truncate text-foreground' style={{ scrollbarWidth: 'none' }}>
            {formatDisplayText(displayValue, true)}
          </div>
        </div>
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
        <div className='absolute top-full left-0 z-[100] mt-1 w-full min-w-[286px]'>
          <div className='allow-scroll fade-in-0 zoom-in-95 animate-in rounded-md border bg-popover text-popover-foreground shadow-lg'>
            <div
              ref={dropdownRef}
              className='allow-scroll max-h-48 overflow-y-auto p-1'
              style={{ scrollbarWidth: 'thin' }}
            >
              {filteredOptions.length === 0 ? (
                <div className='py-6 text-center text-muted-foreground text-sm'>
                  No matching options found.
                </div>
              ) : (
                filteredOptions.map((option, index) => {
                  const optionValue = getOptionValue(option)
                  const optionLabel = getOptionLabel(option)
                  const OptionIcon =
                    typeof option === 'object' && 'icon' in option
                      ? (option.icon as React.ComponentType<{ className?: string }>)
                      : null
                  const isSelected = displayValue === optionValue || displayValue === optionLabel
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
                      {OptionIcon && <OptionIcon className='mr-2 h-3 w-3 opacity-60' />}
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

      <EnvVarDropdown
        visible={showEnvVars}
        onSelect={handleEnvVarSelect}
        searchTerm={searchTerm}
        inputValue={displayValue}
        cursorPosition={cursorPosition}
        onClose={() => {
          setShowEnvVars(false)
          setSearchTerm('')
        }}
      />
      <TagDropdown
        visible={showTags}
        onSelect={handleEnvVarSelect}
        blockId={blockId}
        activeSourceBlockId={activeSourceBlockId}
        inputValue={displayValue}
        cursorPosition={cursorPosition}
        onClose={() => {
          setShowTags(false)
          setActiveSourceBlockId(null)
        }}
      />
    </div>
  )
}
