'use client'

import { type ComponentType, memo, type ReactNode, useCallback, useEffect, useMemo } from 'react'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { Select } from '@sim/emcn/picker/select'
import { useActiveSearchTarget } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/dropdown/dropdown.module.css'
import { isWorkflowSearchTargetForField } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import { selectorPickerSearch } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/selector-input/selector-list-footer'
import {
  getBlock,
  type SubBlockConfig,
  useFetchedOptions,
  useSubBlockStore,
  useSubBlockValue,
  useWorkflowRegistry,
  useWorkflowStore,
} from '@/platform/lib/data/workflow-editor'
import {
  getDependsOnFields,
  getSelectorManifestEntry,
  NO_DENIED_OPERATIONS,
  OPERATION_SUBBLOCK_ID,
  type SelectorKey,
  staleSelectionOptions,
  useDataModeSync,
  useOperationAccess,
  useReactiveConditions,
  useSelectorSearch,
  useWorkspaceOrganizationAccounts,
  withCanonicalModes,
} from '@/platform/lib/data/workflow-editor/selectors'

/**
 * A choice: a plain string, or a labelled id with an optional mark. A `hidden` option leaves the
 * list but still names a stored value, so workflows that chose it keep their label.
 */
type DropdownOption =
  | string
  | {
      label: string
      id: string
      icon?: ComponentType<{ className?: string }>
      hidden?: boolean
      reactiveCondition?: SubBlockConfig['reactiveCondition']
    }

type DropdownOptionsSource =
  | readonly DropdownOption[]
  | ((params?: { values: Record<string, unknown> }) => readonly DropdownOption[])

interface DropdownChoice {
  value: string
  label: string
  icon?: ComponentType<{ className?: string }>
  hidden: boolean
}

const EMPTY_OPTIONS: readonly DropdownOption[] = []
const EMPTY_SUB_BLOCKS: SubBlockConfig[] = []
const EMPTY_VALUES: string[] = []

/** Operations only an organization that allows organization accounts may pick. */
const ORGANIZATION_OPERATIONS = new Set([
  'find_organization_account',
  'list_organization_accounts',
  'find_organization_mcp_connection',
  'list_organization_mcp_connections',
])

/** Static lists longer than this make the operation picker searchable. */
const SEARCHABLE_OPERATION_COUNT = 5

const optionId = (option: DropdownOption) => (typeof option === 'string' ? option : option.id)

interface DropdownProps {
  blockId: string
  subBlockId: string
  config: SubBlockConfig
  /** Static options, a function of the block's values, or absent when `selectorKey` supplies them. */
  options?: DropdownOptionsSource
  /** Chosen when the field holds nothing. */
  defaultValue?: string
  placeholder?: string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
  multiSelect?: boolean
  /** The registered selector that supplies a remote list. */
  selectorKey?: SelectorKey
  /** Leaves the hosting workflow out of a workflow list. */
  selectorExcludeSelf?: boolean
  /** Fields whose change refetches the options. */
  dependsOn?: SubBlockConfig['dependsOn']
  searchable?: boolean
  /** Show labels as written instead of in lowercase. */
  preserveLabelCase?: boolean
}

function OptionMark({ icon: OptionIcon }: { icon: ComponentType<{ className?: string }> }) {
  return (
    <span className={styles.mark} aria-hidden='true'>
      <OptionIcon />
    </span>
  )
}

/**
 * A fixed choice, or several, from static options, a function of the block's values, or a
 * registered selector (searched and paged on the provider, refetched when a dependency changes).
 * It fills itself with a default, hides operations the viewer's permission group denies, and keeps a
 * removed resource removable in a multi-select. The Response block's `dataMode` carries its body
 * across a switch.
 */
export const Dropdown = memo(function Dropdown({
  blockId,
  subBlockId,
  config,
  options,
  defaultValue,
  placeholder = 'Select an option…',
  isPreview = false,
  previewValue,
  disabled = false,
  multiSelect = false,
  selectorKey,
  selectorExcludeSelf,
  dependsOn,
  searchable = false,
  preserveLabelCase = false,
}: DropdownProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const { getDeniedOperations, resolveDefaultOperation, isPermissionLoading } = useOperationAccess()
  const [storeValue, setStoreValue] = useSubBlockValue<string | string[]>(blockId, subBlockId)
  const dependsOnFields = useMemo(() => getDependsOnFields(dependsOn), [dependsOn])

  const blockType = useWorkflowStore((state) => state.blocks[blockId]?.type)
  const canonicalModes = useWorkflowStore((state) => state.blocks[blockId]?.data?.canonicalModes)
  const triggerMode = useWorkflowStore((state) => Boolean(state.blocks[blockId]?.triggerMode))
  const workspaceId = useWorkflowRegistry((state) => state.hydration.workspaceId)
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const isOperation = subBlockId === OPERATION_SUBBLOCK_ID
  const organizationAccounts = useWorkspaceOrganizationAccounts(
    workspaceId ?? undefined,
    blockType === 'credential' && isOperation
  )
  const hideOrganizationOperations =
    blockType === 'credential' && isOperation && organizationAccounts.data?.allowed !== true
  const blockConfig = blockType ? getBlock(blockType) : null

  useDataModeSync({
    blockId,
    subBlockId,
    mode: storeValue,
    enabled: !multiSelect && !isPreview && !disabled,
  })

  const value: unknown = isPreview ? previewValue : storeValue
  const singleValue = !multiSelect && typeof value === 'string' ? value : null
  const multiValues = useMemo(() => {
    if (!multiSelect) return null
    if (Array.isArray(value)) return value.map(String)
    return typeof value === 'string' && value ? [value] : EMPTY_VALUES
  }, [multiSelect, value])

  // A derived list reads the block's own values (a model's reasoning efforts) with the same active
  // member of each canonical pair that conditions read.
  const blockValues = useSubBlockStore((state) =>
    activeWorkflowId ? state.workflowValues[activeWorkflowId]?.[blockId] : undefined
  )
  const evaluatedOptions = useMemo(() => {
    if (typeof options !== 'function') return options ?? EMPTY_OPTIONS
    return options({ values: withCanonicalModes(blockValues ?? {}, canonicalModes) })
  }, [options, blockValues, canonicalModes])

  const reactiveOptions = useMemo(
    () =>
      evaluatedOptions.filter(
        (option): option is Exclude<DropdownOption, string> =>
          typeof option !== 'string' && Boolean(option.reactiveCondition)
      ),
    [evaluatedOptions]
  )
  const hiddenByCondition = useReactiveConditions(
    blockConfig?.subBlocks ?? EMPTY_SUB_BLOCKS,
    blockId,
    activeWorkflowId,
    canonicalModes,
    triggerMode,
    reactiveOptions
  )

  const search = useSelectorSearch()
  const fetched = useFetchedOptions({
    blockId,
    subBlockId,
    dependsOnFields,
    selectorKey,
    selectorExcludeSelf,
    isPreview,
    disabled,
    search: search.activeSearch,
    valueToHydrate: singleValue,
    valuesToHydrate: multiValues ?? undefined,
    localOptions: evaluatedOptions,
  })
  const { refetch: refetchOptions } = fetched

  const allOptions = useMemo(() => {
    let merged: DropdownOption[] =
      fetched.isDynamic && fetched.fetchedOptions.length > 0
        ? fetched.fetchedOptions.map((option) => ({ label: option.label, id: option.id }))
        : [...evaluatedOptions]
    const present = new Set(merged.map(optionId))
    for (const hydrated of [fetched.hydratedOption, ...fetched.hydratedOptions].reverse()) {
      if (hydrated && !present.has(hydrated.id)) {
        merged = [hydrated, ...merged]
        present.add(hydrated.id)
      }
    }
    // A multi-select drops a value by clicking its row, so a selection the loaded list no longer
    // carries gets one of its own.
    if (multiValues && fetched.isDynamic) {
      const stale = staleSelectionOptions({
        selected: multiValues,
        optionIds: present,
        listLoaded: fetched.hasLoadedOptions,
      })
      if (stale.length > 0) merged = [...merged, ...stale]
    }
    return merged
  }, [
    fetched.isDynamic,
    fetched.fetchedOptions,
    fetched.hydratedOption,
    fetched.hydratedOptions,
    fetched.hasLoadedOptions,
    evaluatedOptions,
    multiValues,
  ])

  // The server is the authoritative gate; denied operations only leave the picker.
  const deniedOperationIds = useMemo(() => {
    if (!isOperation) return NO_DENIED_OPERATIONS
    return getDeniedOperations(blockConfig, allOptions.map(optionId))
  }, [isOperation, blockConfig, allOptions, getDeniedOperations])

  const choices = useMemo((): DropdownChoice[] => {
    const toLabel = (raw: string) => (preserveLabelCase ? raw : raw.toLowerCase())
    return allOptions.map((option) => {
      if (typeof option === 'string')
        return { value: option, label: toLabel(option), hidden: deniedOperationIds.has(option) }
      return {
        value: option.id,
        label: toLabel(option.label),
        icon: option.icon,
        hidden: Boolean(
          option.hidden ||
            hiddenByCondition.has(option.id) ||
            deniedOperationIds.has(option.id) ||
            (hideOrganizationOperations && ORGANIZATION_OPERATIONS.has(option.id))
        ),
      }
    })
  }, [
    allOptions,
    deniedOperationIds,
    preserveLabelCase,
    hideOrganizationOperations,
    hiddenByCondition,
  ])

  const choiceByValue = useMemo(
    () => new Map(choices.map((choice) => [choice.value, choice])),
    [choices]
  )

  const defaultOptionValue = useMemo(() => {
    if (multiSelect) return undefined
    // The operation waits for the permission group: seeding the first static option before it
    // loads would persist an operation the group denies, and nothing revisits a filled field.
    if (isOperation)
      return resolveDefaultOperation(
        blockConfig,
        choices.filter((choice) => !choice.hidden).map((choice) => choice.value),
        defaultValue
      )
    if (defaultValue !== undefined) return defaultValue
    return choices.find((choice) => !choice.hidden)?.value
  }, [defaultValue, choices, multiSelect, isOperation, blockConfig, resolveDefaultOperation])

  useEffect(() => {
    if (multiSelect || defaultOptionValue === undefined) return
    if (storeValue === null || storeValue === undefined || storeValue === '')
      setStoreValue(defaultOptionValue)
  }, [storeValue, defaultOptionValue, setStoreValue, multiSelect])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) refetchOptions()
    },
    [refetchOptions]
  )

  const fieldDisabled = isPreview || disabled || (isOperation && isPermissionLoading)
  const label = config.title || placeholder || subBlockId
  const searchMatch = isWorkflowSearchTargetForField({
    activeSearchTarget,
    blockId,
    subBlockId,
    valuePath: multiSelect ? (activeSearchTarget?.valuePath ?? []) : [],
  })
  const manifestSearch = selectorKey ? getSelectorManifestEntry(selectorKey).supportsSearch : false
  const query = search.query.trim().toLowerCase()
  const visibleChoices = choices.filter((choice) => !choice.hidden)
  const listedChoices =
    fetched.isDynamic && !manifestSearch && query
      ? visibleChoices.filter(
          (choice) =>
            choice.label.toLowerCase().includes(query) || choice.value.toLowerCase().includes(query)
        )
      : visibleChoices
  const pickerSearch = fetched.isDynamic
    ? selectorPickerSearch(
        search,
        {
          isLoading: fetched.isLoadingOptions,
          isFetchingMore: fetched.isFetchingMore,
          isLoadingAll: fetched.isLoadingAll,
          hasMore: fetched.hasMore,
          truncated: fetched.truncated,
          error: fetched.fetchError,
          loadMore: fetched.loadMore,
          loadAll: fetched.loadAll,
        },
        listedChoices.length > 0
      )
    : undefined
  const leadingOf = (choice: DropdownChoice | undefined): ReactNode =>
    choice?.icon ? <OptionMark icon={choice.icon} /> : undefined

  let control: ReactNode
  if (multiValues) {
    control = (
      <MultiSelect
        label={label}
        labelHidden
        options={listedChoices.map((choice) => ({
          value: choice.value,
          label: choice.label,
          leading: leadingOf(choice),
        }))}
        value={multiValues}
        selectedLabels={Object.fromEntries(
          multiValues.map((selected) => [selected, choiceByValue.get(selected)?.label ?? selected])
        )}
        onValueChange={(values) => {
          if (fieldDisabled) return
          setStoreValue(values)
          search.reset()
        }}
        placeholder={placeholder}
        searchLabel={`Search ${label.toLowerCase()}`}
        search={pickerSearch}
        onOpenChange={handleOpenChange}
        disabled={fieldDisabled}
      />
    )
  } else {
    const selected = singleValue ? choiceByValue.get(singleValue) : undefined
    const hasIcons = choices.some((choice) => choice.icon)
    const isSearchable = searchable || (isOperation && choices.length > SEARCHABLE_OPERATION_COUNT)
    if (isSearchable || fetched.isDynamic || hasIcons) {
      control = (
        <SearchableSelect
          label={label}
          labelHidden
          options={listedChoices.map((choice) => ({
            value: choice.value,
            label: choice.label,
            leading: leadingOf(choice),
          }))}
          value={singleValue || null}
          selectedLabel={singleValue ? (selected?.label ?? singleValue) : undefined}
          selectedLeading={leadingOf(selected)}
          onValueChange={(next) => {
            if (fieldDisabled || next === null) return
            setStoreValue(next)
            search.reset()
          }}
          onOpenChange={handleOpenChange}
          placeholder={placeholder}
          searchLabel='Search…'
          search={pickerSearch}
          disabled={fieldDisabled}
        />
      )
    } else {
      // A hidden option still names the stored value: it stays listed, unavailable, while chosen.
      const selectOptions = choices
        .filter((choice) => !choice.hidden || choice.value === singleValue)
        .map((choice) => ({ value: choice.value, label: choice.label, disabled: choice.hidden }))
      control = (
        <Select
          label={label}
          options={selectOptions}
          value={singleValue ?? ''}
          placeholder={placeholder}
          onValueChange={(next) => {
            if (!fieldDisabled) setStoreValue(next)
          }}
          disabled={fieldDisabled}
        />
      )
    }
  }

  return (
    <div className={styles.dropdown} data-search-match={searchMatch || undefined}>
      {control}
    </div>
  )
})
