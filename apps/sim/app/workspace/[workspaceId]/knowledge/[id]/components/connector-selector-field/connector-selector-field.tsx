'use client'

import { useMemo, useState } from 'react'
import { ChipCombobox, type ComboboxOption, Loader } from '@sim/emcn'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { SELECTOR_CONTEXT_FIELDS } from '@/lib/workflows/subblocks/context'
import type {
  ConfigFieldMap,
  ConfigFieldValue,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { getDependsOnFields } from '@/blocks/utils'
import type { ConnectorConfigField } from '@/connectors/types'
import { getSelectorDefinition } from '@/hooks/selectors/registry'
import type { SelectorContext, SelectorKey } from '@/hooks/selectors/types'
import {
  useSelectorOptionDetail,
  useSelectorOptionDetails,
  useSelectorOptions,
} from '@/hooks/selectors/use-selector-query'
import { useDebounce } from '@/hooks/use-debounce'

interface ConnectorSelectorFieldProps {
  field: ConnectorConfigField & { selectorKey: SelectorKey }
  value: ConfigFieldValue
  onChange: (value: ConfigFieldValue) => void
  credentialId: string | null
  sourceConfig: ConfigFieldMap
  configFields: ConnectorConfigField[]
  canonicalModes: Record<string, 'basic' | 'advanced'>
  disabled?: boolean
}

export function ConnectorSelectorField({
  field,
  value,
  onChange,
  credentialId,
  sourceConfig,
  configFields,
  canonicalModes,
  disabled,
}: ConnectorSelectorFieldProps) {
  const isMulti = Boolean(field.multi)
  const [searchTerm, setSearchTerm] = useState('')

  const context = useMemo<SelectorContext>(() => {
    const ctx: SelectorContext = {}
    if (credentialId) ctx.oauthCredential = credentialId
    if (field.mimeType) ctx.mimeType = field.mimeType

    const fieldsById = new Map(configFields.map((f) => [f.id, f]))
    for (const depFieldId of getDependsOnFields(field.dependsOn)) {
      const depField = fieldsById.get(depFieldId)
      const canonicalId = depField?.canonicalParamId ?? depFieldId
      const depValue = resolveDepValue(depFieldId, configFields, canonicalModes, sourceConfig)
      if (depValue && SELECTOR_CONTEXT_FIELDS.has(canonicalId as keyof SelectorContext)) {
        ctx[canonicalId as keyof SelectorContext] = depValue
      }
    }

    return ctx
  }, [credentialId, field.mimeType, field.dependsOn, sourceConfig, configFields, canonicalModes])

  const depsResolved = useMemo(() => {
    if (!field.dependsOn) return true
    const deps = Array.isArray(field.dependsOn) ? field.dependsOn : (field.dependsOn.all ?? [])
    return deps.every((depId) =>
      Boolean(resolveDepValue(depId, configFields, canonicalModes, sourceConfig)?.trim())
    )
  }, [field.dependsOn, sourceConfig, configFields, canonicalModes])

  const isEnabled = !disabled && !!credentialId && depsResolved
  const {
    data: options = [],
    isLoading,
    hasMore,
    isFetchingMore,
    truncated,
    error,
  } = useSelectorOptions(field.selectorKey, {
    context,
    enabled: isEnabled,
  })

  /**
   * Label every selected value, including values restored from saved config that no
   * in-session search would have resolved. Queries are keyed on `context`, so a label
   * can never outlive the context that produced it, and they share keys with the
   * speculative lookup below so an already-resolved id costs no extra request.
   */
  const singleValue = Array.isArray(value) ? value[0] : value
  const selectedIds = useMemo(
    () => (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean),
    [value]
  )
  const selectedOptions = useSelectorOptionDetails(field.selectorKey, {
    context,
    detailIds: isEnabled ? selectedIds : [],
  })

  /**
   * The option list fills by draining pages in the background and the combobox filters
   * it client-side, so an option is only findable once its page has arrived. Where the
   * selector's `fetchById` tolerates an unknown id, whatever the user typed is resolved
   * directly so an exact key is selectable immediately. Gated on that flag because most
   * implementations resolve a record by id, where a partial keystroke is a guaranteed
   * failed upstream request rather than an empty result.
   */
  const resolvesUnknownIds = Boolean(getSelectorDefinition(field.selectorKey).resolvesUnknownIds)
  const debouncedSearch = useDebounce(searchTerm.trim(), SEARCH_DEBOUNCE_MS)
  const { data: searchedOption } = useSelectorOptionDetail(field.selectorKey, {
    context,
    detailId:
      resolvesUnknownIds && isEnabled && debouncedSearch.length > 0 ? debouncedSearch : undefined,
  })

  const emptyMessage = getEmptyMessage(field.title.toLowerCase(), {
    error,
    hasMore,
    isFetchingMore,
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
    return extras.length > 0 ? [...extras, ...base] : base
  }, [options, selectedOptions, searchedOption])

  if (isLoading && isEnabled) {
    return (
      <div className='flex h-[30px] items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 font-medium text-[var(--text-muted)] text-small dark:bg-[var(--surface-4)]'>
        <Loader className='size-3.5' animate />
        Loading…
      </div>
    )
  }

  if (isMulti) {
    const multiValues = Array.isArray(value) ? value : value ? [value] : []
    return (
      <ChipCombobox
        multiSelect
        options={comboboxOptions}
        multiSelectValues={multiValues}
        onMultiSelectChange={onChange}
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
        emptyMessage={emptyMessage}
      />
    )
  }

  return (
    <ChipCombobox
      options={comboboxOptions}
      value={singleValue || undefined}
      onChange={onChange}
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
      emptyMessage={emptyMessage}
    />
  )
}

/**
 * Only visible once the first page has landed (`isLoading` renders a spinner
 * before that), so "no match" here means no match among the options drained
 * *so far* — a flat "none found" would wrongly read as "does not exist".
 *
 * `error` is checked before `hasMore`: a failed page halts the drain but leaves
 * `hasMore` set, which would otherwise claim to be loading forever.
 */
function getEmptyMessage(
  noun: string,
  state: {
    error: Error | null
    hasMore: boolean
    isFetchingMore: boolean
    truncated: boolean
  }
): string {
  if (state.error) return 'No match — the list failed to load. Try reopening'
  if (state.hasMore || state.isFetchingMore) return 'No match yet — still loading…'
  if (state.truncated) return 'No match — too many to list. Try a more exact term'
  // `noun` is singular on some connectors ("Base") and plural on others ("Spaces"),
  // so only this settled message puts it behind a quantifier.
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
