'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChipCombobox, type ChipModalFieldAria, type ComboboxOption } from '@sim/emcn'
import { isEqual } from 'es-toolkit'
import { useParams } from 'next/navigation'
import { type ResourceScope, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { projectSelectorContext } from '@/lib/selectors/context'
import { getSelectorManifestEntry, type SelectorKey } from '@/lib/selectors/manifest'
import type { SelectorContext, SelectorSurface } from '@/lib/selectors/types'
import { MAX_PERSONAL_SOURCE_SETUP_KEYS } from '@/lib/sim-search/personal-source-setup'
import type { SourceSelectionLabel } from '@/lib/sim-search/source-identity'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { getDependsOnFields } from '@/lib/workflows/subblocks/dependencies'
import type {
  ConfigFieldMap,
  ConfigFieldValue,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import type { ConnectorConfigField } from '@/connectors/types'
import {
  useSelectorOptionDetail,
  useSelectorOptionDetails,
  useSelectorOptions,
} from '@/hooks/queries/selectors'
import { useDebounce } from '@/hooks/use-debounce'

interface ConnectorSelectorFieldProps {
  controlAria?: ChipModalFieldAria
  scope?: ResourceScope
  selectorSurface?: SelectorSurface
  field: ConnectorConfigField & { selectorKey: SelectorKey }
  value: ConfigFieldValue
  onChange: (value: ConfigFieldValue, selectedOptions?: SourceSelectionLabel[]) => void
  credentialId: string | null
  serviceAccountSubjectFieldId?: string
  sourceConfig: ConfigFieldMap
  configFields: ConnectorConfigField[]
  canonicalModes: Record<string, 'basic' | 'advanced'>
  selectedLabels?: SourceSelectionLabel[]
  disabled?: boolean
}

export function ConnectorSelectorField({
  controlAria,
  scope: explicitScope,
  selectorSurface,
  field,
  value,
  onChange,
  credentialId,
  serviceAccountSubjectFieldId,
  sourceConfig,
  configFields,
  canonicalModes,
  selectedLabels,
  disabled,
}: ConnectorSelectorFieldProps) {
  const params = useParams<{ workspaceId?: string; organizationId?: string }>()
  const scope = explicitScope ?? resourceScopeFromOwner(params)
  const isMulti = Boolean(field.multi)
  const [searchTerm, setSearchTerm] = useState('')
  const [bulkError, setBulkError] = useState<{ context: SelectorContext; message: string } | null>(
    null
  )
  const bulkGenerationRef = useRef(0)

  useEffect(
    () => () => {
      bulkGenerationRef.current += 1
    },
    []
  )

  const context = useMemo<SelectorContext>(() => {
    const candidate: Record<string, string> = {}
    if (credentialId) candidate.oauthCredential = credentialId
    if (field.mimeType) candidate.mimeType = field.mimeType
    const subject = serviceAccountSubjectFieldId
      ? sourceConfig[serviceAccountSubjectFieldId]
      : undefined
    if (typeof subject === 'string' && subject.trim()) {
      candidate.impersonateUserEmail = subject.trim()
    }

    const fieldsById = new Map(configFields.map((f) => [f.id, f]))
    for (const depFieldId of getDependsOnFields(field.dependsOn)) {
      const depField = fieldsById.get(depFieldId)
      const canonicalId = depField?.canonicalParamId ?? depFieldId
      const depValue = resolveDepValue(depFieldId, configFields, canonicalModes, sourceConfig)
      if (depValue) candidate[canonicalId] = depValue
    }

    return projectSelectorContext(field.selectorKey, candidate)
  }, [
    credentialId,
    serviceAccountSubjectFieldId,
    field.mimeType,
    field.dependsOn,
    field.selectorKey,
    sourceConfig,
    configFields,
    canonicalModes,
  ])

  const depsResolved = useMemo(() => {
    if (!field.dependsOn) return true
    const all = Array.isArray(field.dependsOn) ? field.dependsOn : (field.dependsOn.all ?? [])
    const any = Array.isArray(field.dependsOn) ? [] : (field.dependsOn.any ?? [])
    const hasValue = (depId: string) =>
      Boolean(resolveDepValue(depId, configFields, canonicalModes, sourceConfig)?.trim())
    return all.every(hasValue) && (any.length === 0 || any.some(hasValue))
  }, [field.dependsOn, sourceConfig, configFields, canonicalModes])

  const isEnabled = !disabled && !!credentialId && depsResolved
  const missingDependencyMessage = selectorSurface
    ? 'Enter your Atlassian site first'
    : `Select ${getDependencyLabel(field, configFields)} first`
  const debouncedSearch = useDebounce(searchTerm.trim(), SEARCH_DEBOUNCE_MS)
  const {
    data: options = [],
    isLoading,
    isFetching,
    hasMore,
    isFetchingMore,
    isLoadingAll,
    truncated,
    loadMore,
    loadAll,
    refetch,
    error,
  } = useSelectorOptions(field.selectorKey, {
    context,
    scope,
    surface: selectorSurface,
    search: debouncedSearch,
    enabled: isEnabled,
    surfaceId: `connector:${field.id}`,
  })

  const singleValue = Array.isArray(value) ? value[0] : value
  const selectedIds = useMemo(
    () => (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean),
    [value]
  )
  const missingSelectedIds = useMemo(() => {
    const loadedIds = new Set(options.map((option) => option.id))
    /** The trigger displays at most two labels; additional selections are counted. */
    return selectedIds.slice(0, 2).filter((id) => !loadedIds.has(id))
  }, [options, selectedIds])
  const { data: selectedOptions, isLoading: isLoadingSelectedOptions } = useSelectorOptionDetails(
    field.selectorKey,
    {
      context,
      scope,
      surface: selectorSurface,
      detailIds: isEnabled ? missingSelectedIds : [],
      surfaceId: `connector:${field.id}`,
    }
  )

  /**
   * Loaded pages are filtered client-side. Where `fetchById` tolerates an unknown id,
   * resolve the typed value directly so an exact key is selectable before its page is
   * loaded. Most implementations treat partial text as a record id, so this remains
   * gated to selectors that explicitly support unknown-id resolution.
   */
  const resolvesUnknownIds = getSelectorManifestEntry(field.selectorKey).resolvesUnknownIds
  const { data: searchedOption } = useSelectorOptionDetail(field.selectorKey, {
    context,
    scope,
    surface: selectorSurface,
    detailId:
      resolvesUnknownIds && isEnabled && debouncedSearch.length > 0 ? debouncedSearch : undefined,
    surfaceId: `connector:${field.id}`,
  })

  const emptyMessage = getEmptyMessage(field.title.toLowerCase(), {
    error,
    truncated,
  })

  const comboboxOptions = useMemo<ComboboxOption[]>(() => {
    const base = options.map((opt) => ({ label: opt.label, value: opt.id }))
    const seen = new Set(base.map((opt) => opt.value))
    const extras: ComboboxOption[] = []
    for (const option of searchedOption ? [...selectedOptions, searchedOption] : selectedOptions) {
      if (seen.has(option.id)) continue
      seen.add(option.id)
      extras.push({ label: option.label, value: option.id })
    }
    for (const option of selectedLabels ?? []) {
      if (seen.has(option.id) || !selectedIds.includes(option.id)) continue
      seen.add(option.id)
      extras.push({ label: option.label, value: option.id, hidden: true })
    }
    return extras.length > 0 ? [...extras, ...base] : base
  }, [options, selectedOptions, searchedOption, selectedLabels, selectedIds])

  const handleChange = (nextValue: ConfigFieldValue) => {
    bulkGenerationRef.current += 1
    setBulkError(null)
    const ids = new Set(Array.isArray(nextValue) ? nextValue : nextValue ? [nextValue] : [])
    const selected = comboboxOptions
      .filter((option) => ids.has(option.value))
      .map((option) => ({ id: option.value, label: option.label }))
    onChange(nextValue, selected)
  }

  const handleSearchChange = (nextSearch: string) => {
    bulkGenerationRef.current += 1
    setBulkError(null)
    setSearchTerm(nextSearch)
  }

  const hasSearch = searchTerm.trim().length > 0 || debouncedSearch.length > 0
  const selectedIdSet = new Set(selectedIds)
  const allSelected =
    !hasMore &&
    !truncated &&
    options.length > 0 &&
    selectedIds.length === options.length &&
    options.every((option) => selectedIdSet.has(option.id))
  const selectAll = async () => {
    if (!isEnabled || hasSearch || isFetching || isLoadingAll) return
    if (allSelected) {
      handleChange([])
      return
    }
    const generation = ++bulkGenerationRef.current
    setBulkError(null)
    const result = await loadAll()
    if (bulkGenerationRef.current !== generation || result.status === 'cancelled') return
    if (result.status !== 'complete') {
      setBulkError({
        context,
        message:
          result.status === 'partial'
            ? 'There are too many results to select all. Select items individually or enter keys.'
            : 'Could not load all options. Try again.',
      })
      return
    }
    if (
      selectorSurface?.kind === 'personal-search-setup' &&
      result.options.length > MAX_PERSONAL_SOURCE_SETUP_KEYS
    ) {
      setBulkError({
        context,
        message: `Select up to ${MAX_PERSONAL_SOURCE_SETUP_KEYS.toLocaleString()} items. Choose a smaller set to continue.`,
      })
      return
    }
    onChange(
      result.options.map((option) => option.id),
      result.options.map((option) => ({ id: option.id, label: option.label }))
    )
  }

  if (isMulti) {
    const multiValues = Array.isArray(value) ? value : value ? [value] : []
    return (
      <div className='flex flex-col gap-1'>
        <ChipCombobox
          {...controlAria}
          aria-label={field.title}
          multiSelect
          options={
            field.allowSelectAll && (options.length > 0 || hasMore)
              ? [
                  {
                    value: '',
                    label: 'All',
                    disabled: !isEnabled || hasSearch || isFetching || isLoadingAll,
                    onSelect: () => void selectAll(),
                    keepOpen: true,
                    selected: allSelected,
                  },
                  ...comboboxOptions,
                ]
              : comboboxOptions
          }
          multiSelectValues={multiValues}
          onMultiSelectChange={handleChange}
          searchable
          onSearchChange={handleSearchChange}
          searchPlaceholder={`Search ${field.title.toLowerCase()}...`}
          placeholder={
            !credentialId
              ? 'Connect an account first'
              : !depsResolved
                ? missingDependencyMessage
                : field.placeholder || `Select ${field.title.toLowerCase()}`
          }
          disabled={disabled || !credentialId || !depsResolved}
          isLoading={isEnabled && (isLoading || (options.length === 0 && isLoadingSelectedOptions))}
          hasMore={hasMore || Boolean(error)}
          isLoadingMore={isFetchingMore}
          isLoadingAll={isLoadingAll}
          truncated={truncated}
          onLoadMore={error ? refetch : loadMore}
          onLoadAll={error ? refetch : loadAll}
          emptyMessage={emptyMessage}
          error={error?.message}
        />
        {bulkError && isEqual(bulkError.context, context) && (
          <p role='alert' className='text-[var(--text-error)] text-caption'>
            {bulkError.message}
          </p>
        )}
      </div>
    )
  }

  return (
    <ChipCombobox
      {...controlAria}
      aria-label={field.title}
      options={comboboxOptions}
      value={singleValue || undefined}
      onChange={handleChange}
      searchable
      onSearchChange={handleSearchChange}
      searchPlaceholder={`Search ${field.title.toLowerCase()}...`}
      placeholder={
        !credentialId
          ? 'Connect an account first'
          : !depsResolved
            ? missingDependencyMessage
            : field.placeholder || `Select ${field.title.toLowerCase()}`
      }
      disabled={disabled || !credentialId || !depsResolved}
      isLoading={isEnabled && (isLoading || (options.length === 0 && isLoadingSelectedOptions))}
      hasMore={hasMore || Boolean(error)}
      isLoadingMore={isFetchingMore}
      isLoadingAll={isLoadingAll}
      truncated={truncated}
      onLoadMore={error ? refetch : loadMore}
      onLoadAll={error ? refetch : loadAll}
      emptyMessage={emptyMessage}
      error={error?.message}
    />
  )
}

function getEmptyMessage(
  noun: string,
  state: {
    error: Error | null
    truncated: boolean
  }
): string {
  if (state.error) return 'Could not load options. Try again.'
  if (state.truncated) return 'No match — too many to list. Try a more exact term'
  return `No ${noun} found`
}

function resolveDepValue(
  depFieldId: string,
  configFields: ConnectorConfigField[],
  canonicalModes: Record<string, 'basic' | 'advanced'>,
  sourceConfig: ConfigFieldMap
): string {
  const depField = configFields.find((f) => f.id === depFieldId)
  /**
   * For multi-value parent fields, pass all selected values to dependent
   * selectors as a comma-joined string so the downstream selector can load
   * options across every selected parent (e.g. Linear projects across multiple
   * selected teams). Single-value parents pass through unchanged.
   */
  const readDep = (raw: ConfigFieldValue | undefined): string => {
    if (Array.isArray(raw)) return raw.join(',')
    return raw ?? ''
  }
  if (!depField?.canonicalParamId) return readDep(sourceConfig[depFieldId])

  const activeMode = canonicalModes[depField.canonicalParamId] ?? 'basic'
  if (depField.mode === activeMode) return readDep(sourceConfig[depFieldId])

  const activeField = configFields.find(
    (f) => f.canonicalParamId === depField.canonicalParamId && f.mode === activeMode
  )
  return activeField ? readDep(sourceConfig[activeField.id]) : readDep(sourceConfig[depFieldId])
}

function getDependencyLabel(
  field: ConnectorConfigField,
  configFields: ConnectorConfigField[]
): string {
  const deps = getDependsOnFields(field.dependsOn)
  const depField = deps.length > 0 ? configFields.find((f) => f.id === deps[0]) : undefined
  return depField?.title?.toLowerCase() ?? 'dependency'
}
