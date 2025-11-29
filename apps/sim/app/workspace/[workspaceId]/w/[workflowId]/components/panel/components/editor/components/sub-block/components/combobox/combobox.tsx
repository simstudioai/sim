import { useCallback, useEffect, useMemo, useState } from 'react'
import { useReactFlow } from 'reactflow'
import { Combobox, type ComboboxOption } from '@/components/emcn/components'
import { cn } from '@/lib/utils'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { SubBlockInputController } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/sub-block-input-controller'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import type { SubBlockConfig } from '@/blocks/types'

/**
 * Constants for ComboBox component behavior
 */
const DEFAULT_MODEL = 'gpt-4o'
const ZOOM_FACTOR_BASE = 0.96
const MIN_ZOOM = 0.1
const MAX_ZOOM = 1
const ZOOM_DURATION = 0

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
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const reactFlowInstance = useReactFlow()

  // State management
  const [storeInitialized, setStoreInitialized] = useState(false)

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
   * Resolve the user-facing text for the current stored value.
   * - For object options, map stored ID -> label
   * - For everything else, display the raw value
   */
  const displayValue = useMemo(() => {
    const raw = value?.toString() ?? ''
    if (!raw) return ''

    const match = evaluatedOptions.find((option) =>
      typeof option === 'string' ? option === raw : option.id === raw
    )

    if (!match) return raw
    return typeof match === 'string' ? match : match.label
  }, [value, evaluatedOptions])

  const [inputValue, setInputValue] = useState(displayValue)

  useEffect(() => {
    setInputValue(displayValue)
  }, [displayValue])

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

  /**
   * Gets the icon for the currently selected option
   */
  const selectedOption = useMemo(() => {
    if (!value) return undefined
    return comboboxOptions.find((opt) => opt.value === value)
  }, [comboboxOptions, value])

  const selectedOptionIcon = selectedOption?.icon

  /**
   * Overlay content for the editable combobox
   */
  const overlayContent = useMemo(() => {
    const SelectedIcon = selectedOptionIcon
    const displayLabel = inputValue
    return (
      <div className='flex w-full items-center truncate [scrollbar-width:none]'>
        {SelectedIcon && <SelectedIcon className='mr-[8px] h-3 w-3 flex-shrink-0 opacity-60' />}
        <div className='truncate'>
          {formatDisplayText(displayLabel, {
            accessiblePrefixes,
            highlightAll: !accessiblePrefixes,
          })}
        </div>
      </div>
    )
  }, [inputValue, accessiblePrefixes, selectedOption, selectedOptionIcon])

  return (
    <div className='relative w-full'>
      <SubBlockInputController
        blockId={blockId}
        subBlockId={subBlockId}
        config={config}
        value={propValue}
        onChange={(newValue) => {
          if (isPreview) {
            return
          }

          const matchedOption = evaluatedOptions.find((option) => {
            if (typeof option === 'string') {
              return option === newValue
            }
            return option.id === newValue
          })

          if (!matchedOption) {
            return
          }

          const nextValue = typeof matchedOption === 'string' ? matchedOption : matchedOption.id
          setStoreValue(nextValue)
        }}
        isPreview={isPreview}
        disabled={disabled}
        previewValue={previewValue}
      >
        {({ ref, onChange: ctrlOnChange, onDrop, onDragOver }) => (
          <Combobox
            options={comboboxOptions}
            value={inputValue}
            selectedValue={value ?? ''}
            onChange={(newValue) => {
              const matchedComboboxOption = comboboxOptions.find(
                (option) => option.value === newValue
              )
              if (matchedComboboxOption) {
                setInputValue(matchedComboboxOption.label)
              } else {
                setInputValue(newValue)
              }

              // Use controller's handler so env vars, tags, and DnD still work
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
              onWheel: handleWheel,
              autoComplete: 'off',
            }}
          />
        )}
      </SubBlockInputController>
    </div>
  )
}
