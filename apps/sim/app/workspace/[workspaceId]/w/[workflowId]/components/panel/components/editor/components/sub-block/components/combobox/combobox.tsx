import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isEqual } from 'lodash'
import { useReactFlow } from 'reactflow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { Combobox, type ComboboxOption } from '@/components/emcn/components'
import { cn } from '@/lib/core/utils/cn'
import { buildCanonicalIndex, resolveDependencyValue } from '@/lib/workflows/subblocks/visibility'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { SubBlockInputController } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/sub-block-input-controller'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import { getDependsOnFields } from '@/blocks/utils'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { getProviderFromModel } from '@/providers/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * Constants for ComboBox component behavior
 */
const DEFAULT_MODEL = 'claude-sonnet-4-5'
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
  /** Async function to fetch options dynamically */
  fetchOptions?: (
    blockId: string,
    subBlockId: string
  ) => Promise<Array<{ label: string; id: string }>>
  /** Async function to fetch a single option's label by ID (for hydration) */
  fetchOptionById?: (
    blockId: string,
    subBlockId: string,
    optionId: string
  ) => Promise<{ label: string; id: string } | null>
  /** Field dependencies that trigger option refetch when changed */
  dependsOn?: SubBlockConfig['dependsOn']
}

export const ComboBox = memo(function ComboBox({
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
  fetchOptions,
  fetchOptionById,
  dependsOn,
}: ComboBoxProps) {
  // Hooks and context
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const reactFlowInstance = useReactFlow()

  // Dependency tracking for fetchOptions
  const dependsOnFields = useMemo(() => getDependsOnFields(dependsOn), [dependsOn])
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)
  const blockState = useWorkflowStore((state) => state.blocks[blockId])
  const blockConfig = blockState?.type ? getBlock(blockState.type) : null
  const canonicalIndex = useMemo(
    () => buildCanonicalIndex(blockConfig?.subBlocks || []),
    [blockConfig?.subBlocks]
  )
  const canonicalModeOverrides = blockState?.data?.canonicalModes
  const dependencyValues = useStoreWithEqualityFn(
    useSubBlockStore,
    useCallback(
      (state) => {
        if (dependsOnFields.length === 0 || !activeWorkflowId) return []
        const workflowValues = state.workflowValues[activeWorkflowId] || {}
        const blockValues = workflowValues[blockId] || {}
        return dependsOnFields.map((depKey) =>
          resolveDependencyValue(depKey, blockValues, canonicalIndex, canonicalModeOverrides)
        )
      },
      [dependsOnFields, activeWorkflowId, blockId, canonicalIndex, canonicalModeOverrides]
    ),
    isEqual
  )

  // State management
  const [storeInitialized, setStoreInitialized] = useState(false)
  const [fetchedOptions, setFetchedOptions] = useState<Array<{ label: string; id: string }>>([])
  const [isLoadingOptions, setIsLoadingOptions] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [hydratedOption, setHydratedOption] = useState<{ label: string; id: string } | null>(null)
  const previousDependencyValuesRef = useRef<string>('')

  /**
   * Fetches options from the async fetchOptions function if provided
   */
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

  // Determine the active value based on mode (preview vs. controlled vs. store)
  const value = isPreview ? previewValue : propValue !== undefined ? propValue : storeValue

  // Permission-based filtering for model dropdowns
  const { isProviderAllowed, isLoading: isPermissionLoading } = usePermissionConfig()

  // Evaluate static options if provided as a function
  const staticOptions = useMemo(() => {
    const opts = typeof options === 'function' ? options() : options

    if (subBlockId === 'model') {
      return opts.filter((opt) => {
        const modelId = typeof opt === 'string' ? opt : opt.id
        try {
          const providerId = getProviderFromModel(modelId)
          return isProviderAllowed(providerId)
        } catch {
          return true
        }
      })
    }

    return opts
  }, [options, subBlockId, isProviderAllowed])

  // Normalize fetched options to match ComboBoxOption format
  const normalizedFetchedOptions = useMemo((): ComboBoxOption[] => {
    return fetchedOptions.map((opt) => ({ label: opt.label, id: opt.id }))
  }, [fetchedOptions])

  // Merge static and fetched options - fetched options take priority when available
  const evaluatedOptions = useMemo((): ComboBoxOption[] => {
    let opts: ComboBoxOption[] =
      fetchOptions && normalizedFetchedOptions.length > 0 ? normalizedFetchedOptions : staticOptions

    if (subBlockId === 'model' && fetchOptions && normalizedFetchedOptions.length > 0) {
      opts = opts.filter((opt) => {
        const modelId = typeof opt === 'string' ? opt : opt.id
        try {
          const providerId = getProviderFromModel(modelId)
          return isProviderAllowed(providerId)
        } catch {
          return true
        }
      })
    }

    // Merge hydrated option if not already present
    if (hydratedOption) {
      const alreadyPresent = opts.some((o) =>
        typeof o === 'string' ? o === hydratedOption.id : o.id === hydratedOption.id
      )
      if (!alreadyPresent) {
        opts = [hydratedOption, ...opts]
      }
    }

    return opts
  }, [
    fetchOptions,
    normalizedFetchedOptions,
    staticOptions,
    hydratedOption,
    subBlockId,
    isProviderAllowed,
  ])

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
   * Priority: explicit defaultValue > claude-sonnet-4-5 for model field > first option
   */
  const defaultOptionValue = useMemo(() => {
    if (defaultValue !== undefined) {
      return defaultValue
    }

    // For model field, default to claude-sonnet-4-5 if available
    if (subBlockId === 'model') {
      const claudeSonnet45 = evaluatedOptions.find((opt) => getOptionValue(opt) === DEFAULT_MODEL)
      if (claudeSonnet45) {
        return getOptionValue(claudeSonnet45)
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

  // Set default value once store is initialized and permissions are loaded
  useEffect(() => {
    if (isPermissionLoading) return
    if (!storeInitialized) return
    if (defaultOptionValue === undefined) return

    // Only set default when no value exists (initial block add)
    if (value === null || value === undefined) {
      setStoreValue(defaultOptionValue)
    }
  }, [storeInitialized, value, defaultOptionValue, setStoreValue, isPermissionLoading])

  // Clear fetched options and hydrated option when dependencies change
  useEffect(() => {
    if (fetchOptions && dependsOnFields.length > 0) {
      const currentDependencyValuesStr = JSON.stringify(dependencyValues)
      const previousDependencyValuesStr = previousDependencyValuesRef.current

      if (
        previousDependencyValuesStr &&
        currentDependencyValuesStr !== previousDependencyValuesStr
      ) {
        setFetchedOptions([])
        setHydratedOption(null)
      }

      previousDependencyValuesRef.current = currentDependencyValuesStr
    }
  }, [dependencyValues, fetchOptions, dependsOnFields.length])

  // Fetch options when needed (on mount, when enabled, or when dependencies change)
  useEffect(() => {
    if (
      fetchOptions &&
      !isPreview &&
      !disabled &&
      fetchedOptions.length === 0 &&
      !isLoadingOptions &&
      !fetchError
    ) {
      fetchOptionsIfNeeded()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchOptionsIfNeeded deps already covered above
  }, [
    fetchOptions,
    isPreview,
    disabled,
    fetchedOptions.length,
    isLoadingOptions,
    fetchError,
    dependencyValues,
  ])

  // Hydrate the stored value's label by fetching it individually
  useEffect(() => {
    if (!fetchOptionById || isPreview || disabled) return

    const valueToHydrate = value as string | null | undefined
    if (!valueToHydrate) return

    // Skip if value is an expression (not a real ID)
    if (valueToHydrate.startsWith('<') || valueToHydrate.includes('{{')) return

    // Skip if already hydrated with the same value
    if (hydratedOption?.id === valueToHydrate) return

    // Skip if value is already in fetched options or static options
    const alreadyInFetchedOptions = fetchedOptions.some((opt) => opt.id === valueToHydrate)
    const alreadyInStaticOptions = staticOptions.some((opt) =>
      typeof opt === 'string' ? opt === valueToHydrate : opt.id === valueToHydrate
    )
    if (alreadyInFetchedOptions || alreadyInStaticOptions) return

    // Track if effect is still active (cleanup on unmount or value change)
    let isActive = true

    // Fetch the hydrated option
    fetchOptionById(blockId, subBlockId, valueToHydrate)
      .then((option) => {
        if (isActive) setHydratedOption(option)
      })
      .catch(() => {
        if (isActive) setHydratedOption(null)
      })

    return () => {
      isActive = false
    }
  }, [
    fetchOptionById,
    value,
    blockId,
    subBlockId,
    isPreview,
    disabled,
    fetchedOptions,
    staticOptions,
    hydratedOption?.id,
  ])

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
   * Handles combobox open state changes to trigger option fetching
   */
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        void fetchOptionsIfNeeded()
      }
    },
    [fetchOptionsIfNeeded]
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
        {SelectedIcon && <SelectedIcon className='mr-[8px] h-3 w-3 flex-shrink-0' />}
        <div className='truncate'>
          {formatDisplayText(displayLabel, {
            accessiblePrefixes,
            highlightAll: !accessiblePrefixes,
          })}
        </div>
      </div>
    )
  }, [inputValue, accessiblePrefixes, selectedOption, selectedOptionIcon])

  const ctrlOnChangeRef = useRef<
    ((e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => void) | null
  >(null)
  const onDropRef = useRef<
    ((e: React.DragEvent<HTMLTextAreaElement | HTMLInputElement>) => void) | null
  >(null)
  const onDragOverRef = useRef<
    ((e: React.DragEvent<HTMLTextAreaElement | HTMLInputElement>) => void) | null
  >(null)
  const inputRefFromController = useRef<HTMLInputElement | null>(null)

  const comboboxOnChange = useCallback(
    (newValue: string) => {
      const matchedComboboxOption = comboboxOptions.find((option) => option.value === newValue)
      if (matchedComboboxOption) {
        setInputValue(matchedComboboxOption.label)
      } else {
        setInputValue(newValue)
      }

      // Use controller's handler so env vars, tags, and DnD still work
      const syntheticEvent = {
        target: { value: newValue, selectionStart: newValue.length },
      } as React.ChangeEvent<HTMLInputElement>
      ctrlOnChangeRef.current?.(syntheticEvent)
    },
    [comboboxOptions, setInputValue]
  )

  const comboboxInputProps = useMemo(
    () => ({
      onDrop: ((e: React.DragEvent<HTMLInputElement>) => {
        onDropRef.current?.(e)
      }) as (e: React.DragEvent<HTMLInputElement>) => void,
      onDragOver: ((e: React.DragEvent<HTMLInputElement>) => {
        onDragOverRef.current?.(e)
      }) as (e: React.DragEvent<HTMLInputElement>) => void,
      onWheel: handleWheel,
      autoComplete: 'off' as const,
    }),
    [handleWheel]
  )

  // Stable onChange for SubBlockInputController
  const controllerOnChange = useCallback(
    (newValue: string) => {
      if (isPreview) {
        return
      }

      const matchedOption = evaluatedOptions.find((option) => {
        if (typeof option === 'string') {
          return option === newValue
        }
        return option.id === newValue
      })

      // If a matching option is found, store its ID; otherwise store the raw value
      // (allows expressions like <block.output> to be entered directly)
      const nextValue = matchedOption
        ? typeof matchedOption === 'string'
          ? matchedOption
          : matchedOption.id
        : newValue
      setStoreValue(nextValue)
    },
    [isPreview, evaluatedOptions, setStoreValue]
  )

  return (
    <div className='relative w-full'>
      <SubBlockInputController
        blockId={blockId}
        subBlockId={subBlockId}
        config={config}
        value={propValue}
        onChange={controllerOnChange}
        isPreview={isPreview}
        disabled={disabled}
        previewValue={previewValue}
      >
        {({ ref, onChange: ctrlOnChange, onDrop, onDragOver }) => {
          // Update refs with latest handlers from render prop
          ctrlOnChangeRef.current = ctrlOnChange
          onDropRef.current = onDrop
          onDragOverRef.current = onDragOver
          // Store the input ref for passing to Combobox
          if (ref.current) {
            inputRefFromController.current = ref.current as HTMLInputElement
          }

          return (
            <Combobox
              options={comboboxOptions}
              value={inputValue}
              selectedValue={value ?? ''}
              onChange={comboboxOnChange}
              placeholder={placeholder}
              disabled={disabled}
              editable
              overlayContent={overlayContent}
              inputRef={ref as React.RefObject<HTMLInputElement>}
              filterOptions
              searchable={config.searchable}
              className={cn('allow-scroll overflow-x-auto', selectedOptionIcon && 'pl-[28px]')}
              inputProps={comboboxInputProps}
              isLoading={isLoadingOptions}
              error={fetchError}
              onOpenChange={handleOpenChange}
            />
          )
        }}
      </SubBlockInputController>
    </div>
  )
})
