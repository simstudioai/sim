'use client'

import { useMemo, useState } from 'react'
import { ChipCombobox, type ComboboxOption } from '@sim/emcn'
import { useParams } from 'next/navigation'
import { type ResourceScope, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { projectSelectorContext } from '@/lib/selectors/context'
import { getSelectorManifestEntry, type SelectorKey } from '@/lib/selectors/manifest'
import type { SelectorContext } from '@/lib/selectors/types'
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
  scope?: ResourceScope
  field: ConnectorConfigField & { selectorKey: SelectorKey }
  value: ConfigFieldValue
  onChange: (value: ConfigFieldValue, selectedOptions?: SourceSelectionLabel[]) => void
  credentialId: string | null
  sourceConfig: ConfigFieldMap
  configFields: ConnectorConfigField[]
  canonicalModes: Record<string, 'basic' | 'advanced'>
  selectedLabels?: SourceSelectionLabel[]
  disabled?: boolean
}

export function ConnectorSelectorField({
  scope: explicitScope,
  field,
  value,
  onChange,
  credentialId,
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

  const context = useMemo<SelectorContext>(() => {
    const candidate: Record<string, string> = {}
    if (credentialId) candidate.oauthCredential = credentialId
    if (field.mimeType) candidate.mimeType = field.mimeType

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
  const debouncedSearch = useDebounce(searchTerm.trim(), SEARCH_DEBOUNCE_MS)
  const {
    data: options = [],
    isLoading,
    hasMore,
    isFetchingMore,
    isLoadingAll,
    truncated,
    loadMore,
    loadAll,
    error,
  } = useSelectorOptions(field.selectorKey, {
    context,
    scope,
    search: debouncedSearch,
    enabled: isEnabled,
    surfaceId: `connector:${field.id}`,
  })

  /**
   * Label every selected value, including values restored from saved config that no
   * in-session search would have resolved. Opaque revisions bind each label request to
   * the active context without placing credential or dependency values in its query key.
   */
  const singleValue = Array.isArray(value) ? value[0] : value
  const selectedIds = useMemo(
    () => (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean),
    [value]
  )
  const { data: selectedOptions, isLoading: isLoadingSelectedOptions } = useSelectorOptionDetails(
    field.selectorKey,
    {
      context,
      scope,
      detailIds: isEnabled ? selectedIds : [],
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
    const ids = new Set(Array.isArray(nextValue) ? nextValue : nextValue ? [nextValue] : [])
    const selected = comboboxOptions
      .filter((option) => ids.has(option.value))
      .map((option) => ({ id: option.value, label: option.label }))
    onChange(nextValue, selected)
  }

  if (isMulti) {
    const multiValues = Array.isArray(value) ? value : value ? [value] : []
    return (
      <ChipCombobox
        multiSelect
        options={comboboxOptions}
        multiSelectValues={multiValues}
        onMultiSelectChange={handleChange}
        searchable
        onSearchChange={setSearchTerm}
        searchPlaceholder={`Search ${field.title.toLowerCase()}...`}
        placeholder={
          !credentialId
            ? 'Connect an account first'
            : !depsResolved
              ? `Select ${getDependencyLabel(field, configFields)} first`
              : field.placeholder || `Select ${field.title.toLowerCase()}`
        }
        disabled={disabled || !credentialId || !depsResolved}
        isLoading={isEnabled && (isLoading || isLoadingSelectedOptions)}
        hasMore={hasMore}
        isLoadingMore={isFetchingMore}
        isLoadingAll={isLoadingAll}
        truncated={truncated}
        onLoadMore={loadMore}
        onLoadAll={loadAll}
        emptyMessage={emptyMessage}
      />
    )
  }

  return (
    <ChipCombobox
      options={comboboxOptions}
      value={singleValue || undefined}
      onChange={handleChange}
      searchable
      onSearchChange={setSearchTerm}
      searchPlaceholder={`Search ${field.title.toLowerCase()}...`}
      placeholder={
        !credentialId
          ? 'Connect an account first'
          : !depsResolved
            ? `Select ${getDependencyLabel(field, configFields)} first`
            : field.placeholder || `Select ${field.title.toLowerCase()}`
      }
      disabled={disabled || !credentialId || !depsResolved}
      isLoading={isEnabled && (isLoading || isLoadingSelectedOptions)}
      hasMore={hasMore}
      isLoadingMore={isFetchingMore}
      isLoadingAll={isLoadingAll}
      truncated={truncated}
      onLoadMore={loadMore}
      onLoadAll={loadAll}
      emptyMessage={emptyMessage}
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
  if (state.error) return 'No match — the list failed to load. Try reopening'
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
