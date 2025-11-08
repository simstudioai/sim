import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useReactFlow } from 'reactflow'
import { Combobox, type ComboboxOption } from '@/components/emcn/components'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/formatted-text'
import { SubBlockInputController } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/sub-block-input-controller'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import type { SubBlockConfig } from '@/blocks/types'

const logger = createLogger('ComboBox')

/**
 * Constants for ComboBox component behavior
 */
const CURSOR_POSITION_DELAY = 0
const SCROLL_SYNC_DELAY = 0
const DEFAULT_MODEL = 'gpt-4o'
const ZOOM_FACTOR_BASE = 0.96
const MIN_ZOOM = 0.1
const MAX_ZOOM = 1
const ZOOM_DURATION = 0
const DROPDOWN_CLOSE_DELAY = 150

/**
 * Represents a selectable option in the combobox
 */
type ComboBoxOption =
  | string
  | { label: string; id: string; icon?: React.ComponentType<{ className?: string }> }

/**
 * Props for the ComboBox component
 */
interface ComboBoxProps {
  /** Available options for selection - can be static array or function that returns options */
  options: ComboBoxOption[] | (() => ComboBoxOption[])
  /** Default value to use when no value is set */
  defaultValue?: string
  /** ID of the parent block */
  blockId: string
  /** ID of the sub-block this combobox belongs to */
  subBlockId: string
  /** Controlled value (overrides store value when provided) */
  value?: string
  /** Whether the component is in preview mode */
  isPreview?: boolean
  /** Value to display in preview mode */
  previewValue?: string | null
  /** Whether the combobox is disabled */
  disabled?: boolean
  /** Placeholder text when no value is entered */
  placeholder?: string
  /** Configuration for the sub-block */
  config: SubBlockConfig
}

/**
 * ComboBox component that provides a searchable dropdown with support for:
 * - Free text input or selection from predefined options
 * - Environment variable and tag insertion via special triggers
 * - Drag and drop connections from other blocks
 * - Keyboard navigation (Arrow keys, Enter, Escape)
 * - Preview mode for displaying read-only values
 *
 * @param props - Component props
 * @returns Rendered ComboBox component
 */
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
  config,
}: ComboBoxProps) {
  // Hooks and context
  const params = useParams()
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const reactFlowInstance = useReactFlow()

  // State management
  const [storeInitialized, setStoreInitialized] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  // Refs
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Determine the active value based on mode (preview vs. controlled vs. store)
  const value = isPreview ? previewValue : propValue !== undefined ? propValue : storeValue

  // Evaluate options if provided as a function
  const evaluatedOptions = useMemo(() => {
    return typeof options === 'function' ? options() : options
  }, [options])

  // Convert options to Combobox format
  const comboboxOptions = useMemo((): ComboboxOption[] => {
    return evaluatedOptions.map((option) => {
      if (typeof option === 'string') {
        return { label: option, value: option }
      }
      return { label: option.label, value: option.id, icon: option.icon }
    })
  }, [evaluatedOptions])

  /**
   * Extracts the value identifier from an option
   * @param option - The option to extract value from
   * @returns The option's value identifier
   */
  const getOptionValue = useCallback((option: ComboBoxOption): string => {
    return typeof option === 'string' ? option : option.id
  }, [])

  /**
   * Extracts the display label from an option
   * @param option - The option to extract label from
   * @returns The option's display label
   */
  const getOptionLabel = useCallback((option: ComboBoxOption): string => {
    return typeof option === 'string' ? option : option.label
  }, [])

  /**
   * Determines the default option value to use.
   * Priority: explicit defaultValue > gpt-4o for model field > first option
   */
  const defaultOptionValue = useMemo(() => {
    if (defaultValue !== undefined) {
      return defaultValue
    }

    // For model field, default to gpt-4o if available
    if (subBlockId === 'model') {
      const gpt4o = evaluatedOptions.find((opt) => getOptionValue(opt) === DEFAULT_MODEL)
      if (gpt4o) {
        return getOptionValue(gpt4o)
      }
    }

    if (evaluatedOptions.length > 0) {
      return getOptionValue(evaluatedOptions[0])
    }

    return undefined
  }, [defaultValue, evaluatedOptions, subBlockId, getOptionValue])

  /**
   * Filters options based on current input value
   * Shows all options when dropdown is closed or when value matches an exact option
   * Otherwise filters by search term
   */
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
  }, [evaluatedOptions, value, open, getOptionValue, getOptionLabel])

  // Mark store as initialized on first render
  useEffect(() => {
    setStoreInitialized(true)
  }, [])

  // Set default value once store is initialized and value is undefined
  useEffect(() => {
    if (
      storeInitialized &&
      (value === null || value === undefined) &&
      defaultOptionValue !== undefined
    ) {
      setStoreValue(defaultOptionValue)
    }
  }, [storeInitialized, value, defaultOptionValue, setStoreValue])

  /**
   * Handles selection of an option from the dropdown
   * @param selectedValue - The value of the selected option
   */
  const handleSelect = useCallback(
    (selectedValue: string) => {
      if (!isPreview && !disabled) {
        setStoreValue(selectedValue)
      }
      setOpen(false)
      setHighlightedIndex(-1)
      inputRef.current?.blur()
    },
    [isPreview, disabled, setStoreValue]
  )

  /**
   * Handles click on the dropdown chevron button
   * @param e - Mouse event
   */
  const handleDropdownClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!disabled) {
        setOpen((prev) => {
          const newOpen = !prev
          if (newOpen) {
            inputRef.current?.focus()
          }
          return newOpen
        })
      }
    },
    [disabled]
  )

  /**
   * Handles focus event on the input
   */
  const handleFocus = useCallback(() => {
    setOpen(true)
    setHighlightedIndex(-1)
  }, [])

  /**
   * Handles blur event on the input
   * Delays closing to allow for dropdown interactions
   */
  const handleBlur = useCallback(() => {
    // Delay closing to allow dropdown selection
    setTimeout(() => {
      const activeElement = document.activeElement
      if (!activeElement || !activeElement.closest('.absolute.top-full')) {
        setOpen(false)
        setHighlightedIndex(-1)
      }
    }, DROPDOWN_CLOSE_DELAY)
  }, [])

  /**
   * Handles keyboard navigation and selection
   * @param e - Keyboard event
   */
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
    },
    [open, filteredOptions, highlightedIndex, handleSelect, getOptionValue]
  )

  /**
   * Synchronizes overlay scroll with input scroll
   * @param e - UI event from input element
   */
  const handleScroll = useCallback((e: React.UIEvent<HTMLInputElement>) => {
    if (overlayRef.current) {
      overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }, [])

  /**
   * Synchronizes overlay scroll after paste operation
   * @param e - Clipboard event
   */
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    setTimeout(() => {
      if (inputRef.current && overlayRef.current) {
        overlayRef.current.scrollLeft = inputRef.current.scrollLeft
      }
    }, SCROLL_SYNC_DELAY)
  }, [])

  /**
   * Handles wheel event for ReactFlow zoom control
   * Intercepts Ctrl/Cmd+Wheel to zoom the canvas
   * @param e - Wheel event
   * @returns False if zoom was handled, true otherwise
   */
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLInputElement>) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()

        const currentZoom = reactFlowInstance.getZoom()
        const { x: viewportX, y: viewportY } = reactFlowInstance.getViewport()

        const delta = e.deltaY > 0 ? 1 : -1
        const zoomFactor = ZOOM_FACTOR_BASE ** delta
        const newZoom = Math.min(Math.max(currentZoom * zoomFactor, MIN_ZOOM), MAX_ZOOM)

        const { x: pointerX, y: pointerY } = reactFlowInstance.screenToFlowPosition({
          x: e.clientX,
          y: e.clientY,
        })

        const newViewportX = viewportX + (pointerX * currentZoom - pointerX * newZoom)
        const newViewportY = viewportY + (pointerY * currentZoom - pointerY * newZoom)

        reactFlowInstance.setViewport(
          { x: newViewportX, y: newViewportY, zoom: newZoom },
          { duration: ZOOM_DURATION }
        )

        return false
      }
      return true
    },
    [reactFlowInstance]
  )

  // Synchronize overlay scroll position with input when value changes
  useEffect(() => {
    if (inputRef.current && overlayRef.current) {
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft
    }
  }, [value])

  // Adjust highlighted index when filtered options change
  useEffect(() => {
    setHighlightedIndex((prev) => {
      if (prev >= 0 && prev < filteredOptions.length) {
        return prev
      }
      return -1
    })
  }, [filteredOptions])

  // Scroll highlighted option into view for keyboard navigation
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

  // Handle clicks outside the dropdown to close it
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

  const displayValue = useMemo(() => value?.toString() ?? '', [value])

  /**
   * Handles value change from Combobox
   */
  const handleComboboxChange = useCallback(
    (newValue: string) => {
      if (!isPreview) {
        setStoreValue(newValue)
      }
    },
    [isPreview, setStoreValue]
  )

  /**
   * Gets the icon for the currently selected option
   */
  const selectedOptionIcon = useMemo(() => {
    const selectedOpt = comboboxOptions.find((opt) => opt.value === displayValue)
    return selectedOpt?.icon
  }, [comboboxOptions, displayValue])

  /**
   * Overlay content for the editable combobox
   */
  const overlayContent = useMemo(() => {
    const SelectedIcon = selectedOptionIcon
    return (
      <div className='flex w-full items-center truncate [scrollbar-width:none]'>
        {SelectedIcon && <SelectedIcon className='mr-[8px] h-3 w-3 flex-shrink-0 opacity-60' />}
        <div className='truncate'>
          {formatDisplayText(displayValue, {
            accessiblePrefixes,
            highlightAll: !accessiblePrefixes,
          })}
        </div>
      </div>
    )
  }, [displayValue, accessiblePrefixes, selectedOptionIcon])

  /**
   * Handles mouse enter on dropdown option
   * @param index - Index of the option
   */
  const handleOptionMouseEnter = useCallback((index: number) => {
    setHighlightedIndex(index)
  }, [])

  /**
   * Handles mouse down on dropdown option
   * @param e - Mouse event
   * @param optionValue - Value of the selected option
   */
  const handleOptionMouseDown = useCallback(
    (e: React.MouseEvent, optionValue: string) => {
      e.preventDefault()
      handleSelect(optionValue)
    },
    [handleSelect]
  )

  return (
    <div className='relative w-full'>
      <SubBlockInputController
        blockId={blockId}
        subBlockId={subBlockId}
        config={config}
        value={propValue}
        onChange={(newValue) => {
          if (!isPreview) {
            setStoreValue(newValue)
          }
        }}
        isPreview={isPreview}
        disabled={disabled}
        previewValue={previewValue}
      >
        {({ ref, onChange: ctrlOnChange, onDrop, onDragOver }) => (
          <Combobox
            options={comboboxOptions}
            value={displayValue}
            onChange={(newValue) => {
              // Use controller's handler for consistency
              const syntheticEvent = {
                target: { value: newValue, selectionStart: newValue.length },
              } as React.ChangeEvent<HTMLInputElement>
              ctrlOnChange(syntheticEvent)
            }}
            placeholder={placeholder}
            disabled={disabled}
            editable
            overlayContent={overlayContent}
            inputRef={ref as React.RefObject<HTMLInputElement>}
            filterOptions
            className={cn('allow-scroll overflow-x-auto', selectedOptionIcon && 'pl-[28px]')}
            inputProps={{
              onDrop: onDrop as (e: React.DragEvent<HTMLInputElement>) => void,
              onDragOver: onDragOver as (e: React.DragEvent<HTMLInputElement>) => void,
              onScroll: handleScroll,
              onPaste: handlePaste,
              onWheel: handleWheel,
              autoComplete: 'off',
            }}
          />
        )}
      </SubBlockInputController>
    </div>
  )
}
