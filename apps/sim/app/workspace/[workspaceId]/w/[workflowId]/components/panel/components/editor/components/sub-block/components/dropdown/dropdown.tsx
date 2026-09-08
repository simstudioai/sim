import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChipTag, Combobox, type ComboboxOption } from '@sim/emcn'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import {
  NO_DENIED_OPERATIONS,
  OPERATION_SUBBLOCK_ID,
} from '@/lib/permission-groups/operation-access'
import type { SelectorKey } from '@/lib/selectors/manifest'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { getDependsOnFields } from '@/lib/workflows/subblocks/dependencies'
import { staleSelectionOptions } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/dropdown/stale-selections'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { getWorkflowSearchLabelHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useFetchedOptions } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-fetched-options'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import { ResponseBlockHandler } from '@/executor/handlers/response/response-handler'
import { useWorkspaceOrganizationAccounts } from '@/hooks/queries/organization-accounts'
import { useDebounce } from '@/hooks/use-debounce'
import { useOperationAccess } from '@/hooks/use-operation-access'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/** Shared empty list, so a selector-backed field with no static options keeps a stable identity. */
const EMPTY_OPTIONS: DropdownOption[] = []

/** Shared empty list, so a multi-select with no value keeps a stable identity across renders. */
const EMPTY_MULTI_VALUES: string[] = []

/** Selected-value badges shown before folding the rest into a "+N" badge. */
const MAX_VISIBLE_MULTI_SELECT_BADGES = 2

/**
 * Dropdown option type - can be a simple string or an object with label, id, and optional icon.
 * Options with `hidden: true` are excluded from the picker but still resolve for label display,
 * so existing workflows that reference them continue to work.
 */
type DropdownOption =
  | string
  | {
      label: string
      id: string
      icon?: React.ComponentType<{ className?: string }>
      hidden?: boolean
    }

/**
 * Props for the Dropdown component
 */
interface DropdownProps {
  /**
   * Static options, or a function deriving them from the block's own values. Absent on a
   * selector-backed field, whose list comes from `selectorKey` instead — so this must never
   * be read without a default.
   */
  options?: DropdownOption[] | ((params?: { values: Record<string, unknown> }) => DropdownOption[])
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
  /** Registered selector supplying the options. The canonical source for a remote list. */
  selectorKey?: SelectorKey
  /** Drop the hosting workflow from a `sim.workflows` list. */
  selectorExcludeSelf?: boolean
  /** Field dependencies that trigger option refetch when changed */
  dependsOn?: SubBlockConfig['dependsOn']
  /** Enable search input in dropdown */
  searchable?: boolean
  /** Render option labels verbatim instead of lowercasing them */
  preserveLabelCase?: boolean
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
export const Dropdown = memo(function Dropdown({
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
  selectorKey,
  selectorExcludeSelf,
  dependsOn,
  searchable = false,
  preserveLabelCase = false,
}: DropdownProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const { getDeniedOperations, resolveDefaultOperation, isPermissionLoading } = useOperationAccess()
  const [storeValue, setStoreValue] = useSubBlockValue<string | string[]>(blockId, subBlockId) as [
    string | string[] | null | undefined,
    (value: string | string[]) => void,
  ]

  const dependsOnFields = useMemo(() => getDependsOnFields(dependsOn), [dependsOn])

  const blockType = useWorkflowStore((state) => state.blocks[blockId]?.type)
  const workspaceId = useWorkflowRegistry((state) => state.hydration.workspaceId)
  const organizationAccounts = useWorkspaceOrganizationAccounts(
    workspaceId ?? undefined,
    blockType === 'credential' && subBlockId === OPERATION_SUBBLOCK_ID
  )
  const hideOrganizationOperations =
    blockType === 'credential' &&
    subBlockId === OPERATION_SUBBLOCK_ID &&
    organizationAccounts.data?.allowed !== true
  const blockConfig = blockType ? getBlock(blockType) : null

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
  const multiValues = useMemo(() => {
    if (!multiSelect) return null
    if (Array.isArray(value)) return value
    return value ? [value as string] : EMPTY_MULTI_VALUES
  }, [multiSelect, value])

  // Derived option lists read the block's own values (a model's valid reasoning efforts);
  // `dependsOn` already re-renders this control when one of those siblings changes.
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const blockValues = useSubBlockStore((state) =>
    activeWorkflowId ? state.workflowValues[activeWorkflowId]?.[blockId] : undefined
  )
  const evaluatedOptions = useMemo(() => {
    if (typeof options === 'function') return options({ values: blockValues ?? {} })
    return options ?? EMPTY_OPTIONS
  }, [options, blockValues])

  const [selectorSearch, setSelectorSearch] = useState('')
  const debouncedSelectorSearch = useDebounce(selectorSearch.trim(), SEARCH_DEBOUNCE_MS)
  const activeSelectorSearch = selectorSearch.trim() === '' ? '' : debouncedSelectorSearch

  const {
    fetchedOptions,
    isLoadingOptions,
    isFetchingMore,
    isLoadingAll,
    hasMore,
    truncated,
    hasLoadedOptions,
    fetchError,
    hydratedOption,
    hydratedOptions,
    isDynamic,
    loadMore,
    loadAll,
    refetch: refetchOptions,
  } = useFetchedOptions({
    blockId,
    subBlockId,
    dependsOnFields,
    selectorKey,
    selectorExcludeSelf,
    isPreview: Boolean(isPreview),
    disabled: Boolean(disabled),
    search: activeSelectorSearch,
    valueToHydrate: singleValue,
    valuesToHydrate: multiValues ?? undefined,
    localOptions: evaluatedOptions,
  })

  /**
   * Handles combobox open state changes to trigger option fetching
   */
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        refetchOptions()
      }
    },
    [refetchOptions]
  )

  const normalizedFetchedOptions = useMemo(() => {
    return fetchedOptions.map((opt) => ({ label: opt.label, id: opt.id }))
  }, [fetchedOptions])

  const allOptions = useMemo(() => {
    let opts: DropdownOption[] =
      isDynamic && normalizedFetchedOptions.length > 0 ? normalizedFetchedOptions : evaluatedOptions

    if (hydratedOption) {
      const alreadyPresent = opts.some((o) =>
        typeof o === 'string' ? o === hydratedOption.id : o.id === hydratedOption.id
      )
      if (!alreadyPresent) {
        opts = [hydratedOption, ...opts]
      }
    }

    for (const option of [...hydratedOptions].reverse()) {
      const alreadyPresent = opts.some((existing) =>
        typeof existing === 'string' ? existing === option.id : existing.id === option.id
      )
      if (!alreadyPresent) opts = [option, ...opts]
    }

    // A multi-select can only drop a value by clicking its row; a selection the
    // loaded list no longer carries gets one so it can be removed in place.
    if (multiValues && isDynamic) {
      const stale = staleSelectionOptions({
        selected: multiValues,
        optionIds: new Set(opts.map((o) => (typeof o === 'string' ? o : o.id))),
        // An empty list from a completed fetch is authoritative too (every column deleted).
        listLoaded: hasLoadedOptions,
      })
      if (stale.length > 0) opts = [...opts, ...stale]
    }

    return opts
  }, [
    isDynamic,
    normalizedFetchedOptions,
    evaluatedOptions,
    hydratedOption,
    hydratedOptions,
    multiValues,
    hasLoadedOptions,
  ])

  /**
   * Operation IDs whose resolved tool is denied by the caller's permission
   * group. Only the `operation` selector is gated. Denied operations are hidden
   * from the picker (still resolvable for label display); the server is the
   * authoritative gate regardless.
   */
  const deniedOperationIds = useMemo(() => {
    if (subBlockId !== OPERATION_SUBBLOCK_ID) return NO_DENIED_OPERATIONS
    return getDeniedOperations(
      blockConfig,
      allOptions.map((opt) => (typeof opt === 'string' ? opt : opt.id))
    )
  }, [subBlockId, blockConfig, allOptions, getDeniedOperations])

  const comboboxOptions = useMemo((): ComboboxOption[] => {
    const toLabel = (raw: string) => (preserveLabelCase ? raw : raw.toLowerCase())
    return allOptions.map((opt) => {
      if (typeof opt === 'string') {
        return { label: toLabel(opt), value: opt, hidden: deniedOperationIds.has(opt) }
      }
      return {
        label: toLabel(opt.label),
        value: opt.id,
        icon: 'icon' in opt ? opt.icon : undefined,
        hidden:
          opt.hidden ||
          deniedOperationIds.has(opt.id) ||
          (hideOrganizationOperations &&
            [
              'find_organization_account',
              'list_organization_accounts',
              'find_organization_mcp_connection',
              'list_organization_mcp_connections',
            ].includes(opt.id)),
      }
    })
  }, [allOptions, deniedOperationIds, preserveLabelCase, hideOrganizationOperations])

  const optionMap = useMemo(() => {
    return new Map(comboboxOptions.map((opt) => [opt.value, opt.label]))
  }, [comboboxOptions])

  const defaultOptionValue = useMemo(() => {
    if (multiSelect) return undefined

    /**
     * The operation field defaults through the permission gate, which withholds
     * a value until the group config has loaded. Seeding the static first
     * option in that window would persist an operation the group denies —
     * nothing revisits a field that already holds a value, so the correction
     * that arrives with the config would never apply.
     */
    if (subBlockId === OPERATION_SUBBLOCK_ID) {
      const selectableIds = comboboxOptions.filter((opt) => !opt.hidden).map((opt) => opt.value)
      return resolveDefaultOperation(blockConfig, selectableIds, defaultValue)
    }

    if (defaultValue !== undefined) return defaultValue

    return comboboxOptions.find((opt) => !opt.hidden)?.value
  }, [defaultValue, comboboxOptions, multiSelect, subBlockId, blockConfig, resolveDefaultOperation])

  useEffect(() => {
    if (multiSelect || defaultOptionValue === undefined) {
      return
    }
    if (storeValue === null || storeValue === undefined || storeValue === '') {
      setStoreValue(defaultOptionValue)
    }
  }, [storeValue, defaultOptionValue, setStoreValue, multiSelect])

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

      if (isRecordLike(parsed)) {
        return Object.entries(parsed).map(([key, value]) => {
          const fieldType = inferType(value)
          const fieldValue =
            fieldType === 'object' || fieldType === 'array' ? JSON.stringify(value, null, 2) : value

          return {
            id: generateId(),
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
   * Custom overlay content for multi-select mode. Shows at most two badges
   * and folds the rest into a "+N" badge, matching the summary notation used
   * for collapsed subblock rows.
   */
  const multiSelectOverlay = useMemo(() => {
    if (!multiSelect || !multiValues || multiValues.length === 0) return undefined

    const visibleValues = multiValues.slice(0, MAX_VISIBLE_MULTI_SELECT_BADGES)
    const overflowCount = multiValues.length - visibleValues.length

    return (
      <div className='flex items-center gap-1 overflow-hidden whitespace-nowrap'>
        {visibleValues.map((selectedValue: string, index) => {
          const rawLabel = optionMap.get(selectedValue) || selectedValue
          const label = preserveLabelCase ? rawLabel : rawLabel.toLowerCase()
          const workflowSearchHighlight = getWorkflowSearchLabelHighlight({
            activeSearchTarget,
            blockId,
            subBlockId,
            valuePath: [index],
            label,
          })
          return (
            <ChipTag key={selectedValue} variant='field' className='min-w-0 shrink'>
              <span className='truncate'>
                {formatDisplayText(label, { workflowSearchHighlight })}
              </span>
            </ChipTag>
          )
        })}
        {overflowCount > 0 && (
          <ChipTag variant='field' className='shrink-0'>
            +{overflowCount}
          </ChipTag>
        )}
      </div>
    )
  }, [
    activeSearchTarget,
    blockId,
    multiSelect,
    multiValues,
    optionMap,
    preserveLabelCase,
    subBlockId,
  ])

  const singleSelectOverlay = useMemo(() => {
    if (multiSelect || !singleValue) return undefined
    const label = optionMap.get(singleValue)
    if (!label) return undefined
    const workflowSearchHighlight = getWorkflowSearchLabelHighlight({
      activeSearchTarget,
      blockId,
      subBlockId,
      valuePath: [],
      label,
    })
    if (!workflowSearchHighlight) return undefined
    return (
      <span className='truncate text-[var(--text-primary)]'>
        {formatDisplayText(label, { workflowSearchHighlight })}
      </span>
    )
  }, [activeSearchTarget, blockId, multiSelect, optionMap, singleValue, subBlockId])

  const isSearchable = searchable || (subBlockId === 'operation' && comboboxOptions.length > 5)

  return (
    <Combobox
      options={comboboxOptions}
      value={multiSelect ? undefined : (singleValue ?? undefined)}
      multiSelectValues={multiSelect ? (multiValues ?? undefined) : undefined}
      onChange={handleChange}
      onMultiSelectChange={handleMultiSelectChange}
      placeholder={placeholder}
      /* The operation list only drops denied entries once the config resolves,
         and a pick here persists — matching the agent tool selector. */
      disabled={disabled || (subBlockId === OPERATION_SUBBLOCK_ID && isPermissionLoading)}
      editable={false}
      onOpenChange={handleOpenChange}
      overlayContent={multiSelectOverlay ?? singleSelectOverlay}
      multiSelect={multiSelect}
      isLoading={isLoadingOptions}
      isLoadingMore={isFetchingMore}
      isLoadingAll={isLoadingAll}
      hasMore={hasMore}
      truncated={truncated}
      onLoadMore={loadMore}
      onLoadAll={loadAll}
      error={fetchError}
      searchable={isSearchable}
      onSearchChange={setSelectorSearch}
      searchPlaceholder='Search...'
    />
  )
})
