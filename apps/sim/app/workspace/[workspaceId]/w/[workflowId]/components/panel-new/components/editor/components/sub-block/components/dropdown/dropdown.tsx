import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/emcn'
import { Combobox, type ComboboxOption } from '@/components/emcn/components'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import { ResponseBlockHandler } from '@/executor/handlers/response/response-handler'

/**
 * Option type for the dropdown - can be a string or an object with label, id, and optional icon
 */
type DropdownOption =
  | string
  | { label: string; id: string; icon?: React.ComponentType<{ className?: string }> }

/**
 * Props for the Dropdown component
 */
interface DropdownProps {
  /** Available options for selection - can be static array or function that returns options */
  options: DropdownOption[] | (() => DropdownOption[])
  /** Default value to use when no value is set */
  defaultValue?: string
  /** ID of the parent block */
  blockId: string
  /** ID of the sub-block this dropdown belongs to */
  subBlockId: string
  /** Controlled value (overrides store value when provided) */
  value?: string | string[]
  /** Whether the component is in preview mode */
  isPreview?: boolean
  /** Value to display in preview mode */
  previewValue?: string | string[] | null
  /** Whether the dropdown is disabled */
  disabled?: boolean
  /** Placeholder text when no value is selected */
  placeholder?: string
  /** Configuration for the sub-block */
  config?: import('@/blocks/types').SubBlockConfig
  multiSelect?: boolean
  fetchOptions?: (
    blockId: string,
    subBlockId: string
  ) => Promise<Array<{ label: string; id: string }>>
}

/**
 * Dropdown component that provides a select-only interface for choosing from predefined options.
 * Uses the emcn Combobox component in select-only mode.
 *
 * Special handling for response block dataMode conversion between 'structured' and 'json' modes.
 *
 * @param props - Component props
 * @returns Rendered Dropdown component
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
  // Store management
  const [storeValue, setStoreValue] = useSubBlockValue<string | string[]>(blockId, subBlockId) as [
    string | string[] | null | undefined,
    (value: string | string[]) => void,
  ]
  const [storeInitialized, setStoreInitialized] = useState(false)
  const previousModeRef = useRef<string | null>(null)

  const [builderData, setBuilderData] = useSubBlockValue<any[]>(blockId, 'builderData')
  const [data, setData] = useSubBlockValue<string>(blockId, 'data')

  const [fetchedOptions, setFetchedOptions] = useState<Array<{ label: string; id: string }>>([])
  const [isLoadingOptions, setIsLoadingOptions] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const builderDataRef = useRef(builderData)
  const dataRef = useRef(data)

  useEffect(() => {
    builderDataRef.current = builderData
    dataRef.current = data
  }, [builderData, data])

  // Determine the active value based on mode (preview vs. controlled vs. store)
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

  // Evaluate options if provided as a function
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
   * Extracts the display label from an option
   * @param option - The option to extract label from
   * @returns The option's display label
   */
  const getOptionLabel = useCallback((option: DropdownOption): string => {
    return typeof option === 'string' ? option : option.label
  }, [])

  /**
   * Determines the default option value to use.
   * Priority: explicit defaultValue > first option
   */
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

  // Convert options to Combobox format
  const comboboxOptions = useMemo((): ComboboxOption[] => {
    return evaluatedOptions.map((option) => {
      if (typeof option === 'string') {
        return { label: option, value: option }
      }
      return { label: option.label, value: option.id, icon: option.icon }
    })
  }, [evaluatedOptions])

  // Mark store as initialized on first render
  useEffect(() => {
    setStoreInitialized(true)
  }, [])

  // Set default value once store is initialized and value is undefined
  useEffect(() => {
    if (multiSelect || !storeInitialized || defaultOptionValue === undefined) {
      return
    }
    if (storeValue === null || storeValue === undefined || storeValue === '') {
      setStoreValue(defaultOptionValue)
    }
  }, [storeInitialized, storeValue, defaultOptionValue, setStoreValue, multiSelect])

  /**
   * Normalizes variable references in JSON strings
   * Replaces unquoted variable references with quoted ones
   * @param jsonString - JSON string to normalize
   * @returns Normalized JSON string
   */
  const normalizeVariableReferences = useCallback((jsonString: string): string => {
    // Replace unquoted variable references with quoted ones
    // Pattern: <variable.name> -> "<variable.name>"
    return jsonString.replace(/([^"]<[^>]+>)/g, '"$1"')
  }, [])

  /**
   * Infers field type from a value
   * @param value - Value to infer type from
   * @returns Inferred type
   */
  const inferType = useCallback(
    (value: any): 'string' | 'number' | 'boolean' | 'object' | 'array' => {
      if (typeof value === 'boolean') return 'boolean'
      if (typeof value === 'number') return 'number'
      if (Array.isArray(value)) return 'array'
      if (typeof value === 'object' && value !== null) return 'object'
      return 'string'
    },
    []
  )

  /**
   * Converts JSON string to builder data format
   * @param jsonString - JSON string to convert
   * @returns Builder data array
   */
  const convertJsonToBuilderData = useCallback(
    (jsonString: string): any[] => {
      try {
        // Always normalize variable references first
        const normalizedJson = normalizeVariableReferences(jsonString)
        const parsed = JSON.parse(normalizedJson)

        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          return Object.entries(parsed).map(([key, value]) => {
            const fieldType = inferType(value)
            const fieldValue =
              fieldType === 'object' || fieldType === 'array'
                ? JSON.stringify(value, null, 2)
                : value

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
    },
    [normalizeVariableReferences, inferType]
  )

  /**
   * Handles data conversion when dataMode changes between 'structured' and 'json'
   */
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
  }, [
    storeValue,
    subBlockId,
    isPreview,
    disabled,
    setData,
    setBuilderData,
    convertJsonToBuilderData,
    multiSelect,
  ])

  /**
   * Handles value change from Combobox for single-select mode
   * @param newValue - The selected value
   */
  const handleChange = useCallback(
    (newValue: string) => {
      if (!isPreview && !disabled) {
        setStoreValue(newValue)
      }
    },
    [isPreview, disabled, setStoreValue]
  )

  /**
   * Handles value change for multi-select mode
   * @param newValues - The selected values array
   */
  const handleMultiSelectChange = useCallback(
    (newValues: string[]) => {
      if (!isPreview && !disabled) {
        setStoreValue(newValues)
      }
    },
    [isPreview, disabled, setStoreValue]
  )

  const displayValue = useMemo(() => {
    if (multiSelect) return ''
    return value?.toString() ?? ''
  }, [value, multiSelect])

  /**
   * Renders badge display for multi-select mode
   */
  const multiSelectDisplay = useMemo(() => {
    if (!multiSelect || !multiValues || multiValues.length === 0) return null

    const optionsNotLoaded = fetchOptions && fetchedOptions.length === 0

    if (optionsNotLoaded) {
      return (
        <Badge variant='outline' className='text-xs'>
          {multiValues.length} selected
        </Badge>
      )
    }

    return (
      <>
        {multiValues.slice(0, 2).map((selectedValue: string) => (
          <Badge key={selectedValue} variant='outline' className='text-xs'>
            {optionMap.get(selectedValue) || selectedValue}
          </Badge>
        ))}
        {multiValues.length > 2 && (
          <Badge variant='outline' className='text-xs'>
            +{multiValues.length - 2} more
          </Badge>
        )}
      </>
    )
  }, [multiSelect, multiValues, fetchOptions, fetchedOptions.length, optionMap])

  return (
    <div className='relative w-full'>
      <Combobox
        options={comboboxOptions}
        value={displayValue}
        multiSelectValues={multiSelect ? multiValues || [] : undefined}
        onChange={handleChange}
        onMultiSelectChange={handleMultiSelectChange}
        placeholder={multiSelect && multiSelectDisplay ? '' : placeholder}
        disabled={disabled}
        editable={false}
        multiSelect={multiSelect}
        isLoading={isLoadingOptions}
        error={fetchError}
        overlayContent={
          multiSelect && multiSelectDisplay ? (
            <div className='flex flex-wrap items-center gap-1'>{multiSelectDisplay}</div>
          ) : undefined
        }
      />
    </div>
  )
}
