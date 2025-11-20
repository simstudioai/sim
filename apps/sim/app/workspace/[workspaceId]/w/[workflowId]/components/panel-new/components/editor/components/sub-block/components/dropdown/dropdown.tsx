import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/emcn'
import { Combobox, type ComboboxOption } from '@/components/emcn/components'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import { ResponseBlockHandler } from '@/executor/handlers/response/response-handler'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

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
  /** Field dependencies that trigger option refetch when changed */
  dependsOn?: string[]
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
  dependsOn = [],
}: DropdownProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string | string[]>(blockId, subBlockId) as [
    string | string[] | null | undefined,
    (value: string | string[]) => void,
  ]

  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)
  const dependencyValues = useSubBlockStore(
    useCallback(
      (state) => {
        if (dependsOn.length === 0 || !activeWorkflowId) return []
        const workflowValues = state.workflowValues[activeWorkflowId] || {}
        const blockValues = workflowValues[blockId] || {}
        return dependsOn.map((depKey) => blockValues[depKey] ?? null)
      },
      [dependsOn, activeWorkflowId, blockId]
    )
  )

  const [storeInitialized, setStoreInitialized] = useState(false)
  const [fetchedOptions, setFetchedOptions] = useState<Array<{ label: string; id: string }>>([])
  const [isLoadingOptions, setIsLoadingOptions] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const previousModeRef = useRef<string | null>(null)
  const previousDependencyValuesRef = useRef<string>('')

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

  /**
   * Convert dropdown options to Combobox format
   */
  const comboboxOptions = useMemo((): ComboboxOption[] => {
    return availableOptions.map((opt) => {
      if (typeof opt === 'string') {
        return { label: opt.toLowerCase(), value: opt }
      }
      return {
        label: opt.label.toLowerCase(),
        value: opt.id,
        icon: 'icon' in opt ? opt.icon : undefined,
      }
    })
  }, [availableOptions])

  const optionMap = useMemo(() => {
    return new Map(comboboxOptions.map((opt) => [opt.value, opt.label]))
  }, [comboboxOptions])

  const defaultOptionValue = useMemo(() => {
    if (multiSelect) return undefined
    if (defaultValue !== undefined) {
      return defaultValue
    }

    if (comboboxOptions.length > 0) {
      return comboboxOptions[0].value
    }

    return undefined
  }, [defaultValue, comboboxOptions, multiSelect])

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

  /**
   * Handles selection change for both single and multi-select modes
   */
  const handleChange = useCallback(
    (selectedValue: string) => {
      if (!isPreview && !disabled) {
        setStoreValue(selectedValue)
      }
    },
    [isPreview, disabled, setStoreValue]
  )

  /**
   * Handles multi-select changes
   */
  const handleMultiSelectChange = useCallback(
    (selectedValues: string[]) => {
      if (!isPreview && !disabled) {
        setStoreValue(selectedValues)
      }
    },
    [isPreview, disabled, setStoreValue]
  )

  /**
   * Effect to clear fetched options when dependencies actually change
   * This ensures options are refetched with new dependency values (e.g., new credentials)
   */
  useEffect(() => {
    if (fetchOptions && dependsOn.length > 0) {
      const currentDependencyValuesStr = JSON.stringify(dependencyValues)
      const previousDependencyValuesStr = previousDependencyValuesRef.current

      if (
        previousDependencyValuesStr &&
        currentDependencyValuesStr !== previousDependencyValuesStr
      ) {
        setFetchedOptions([])
      }

      previousDependencyValuesRef.current = currentDependencyValuesStr
    }
  }, [dependencyValues, fetchOptions, dependsOn.length])

  /**
   * Effect to fetch options when needed (on mount, when enabled, or when dependencies change)
   */
  useEffect(() => {
    if (
      fetchOptions &&
      !isPreview &&
      !disabled &&
      fetchedOptions.length === 0 &&
      !isLoadingOptions
    ) {
      fetchOptionsIfNeeded()
    }
  }, [
    fetchOptions,
    isPreview,
    disabled,
    fetchedOptions.length,
    isLoadingOptions,
    fetchOptionsIfNeeded,
    dependencyValues, // Refetch when dependencies change
  ])

  /**
   * Custom overlay content for multi-select mode showing badges
   */
  const multiSelectOverlay = useMemo(() => {
    if (!multiSelect || !multiValues || multiValues.length === 0) return undefined

    return (
      <div className='flex items-center gap-1 overflow-hidden whitespace-nowrap'>
        {multiValues.map((selectedValue: string) => (
          <Badge
            key={selectedValue}
            className='shrink-0 rounded-[8px] py-[4px] text-[12px] leading-none'
          >
            {(optionMap.get(selectedValue) || selectedValue).toLowerCase()}
          </Badge>
        ))}
      </div>
    )
  }, [multiSelect, multiValues, optionMap])

  return (
    <Combobox
      options={comboboxOptions}
      value={multiSelect ? undefined : (singleValue ?? undefined)}
      multiSelectValues={multiSelect ? (multiValues ?? undefined) : undefined}
      onChange={handleChange}
      onMultiSelectChange={handleMultiSelectChange}
      placeholder={placeholder}
      disabled={disabled}
      editable={false}
      onOpenChange={(open) => {
        if (open) {
          // Fetch options when the dropdown is opened to ensure freshness
          void fetchOptionsIfNeeded()
        }
      }}
      overlayContent={multiSelectOverlay}
      multiSelect={multiSelect}
      isLoading={isLoadingOptions}
      error={fetchError}
    />
  )
}
