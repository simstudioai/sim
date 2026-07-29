'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChipCombobox, type ComboboxOption, Loader } from '@sim/emcn'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { SELECTOR_CONTEXT_FIELDS } from '@/lib/workflows/subblocks/context'
import type {
  ConfigFieldMap,
  ConfigFieldValue,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { getDependsOnFields } from '@/blocks/utils'
import type { ConnectorConfigField } from '@/connectors/types'
import type { SelectorContext, SelectorKey, SelectorOption } from '@/hooks/selectors/types'
import { useSelectorOptionDetail, useSelectorOptions } from '@/hooks/selectors/use-selector-query'
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
   * The option list fills by draining pages in the background and the combobox
   * filters it client-side, so an option is only findable once its page has
   * arrived. Resolving the typed value directly makes an exact id/key selectable
   * immediately, independent of drain progress. Debounced so typing does not
   * issue a request per keystroke; selectors without a `fetchById` resolve nothing.
   */
  const debouncedSearch = useDebounce(searchTerm.trim(), SEARCH_DEBOUNCE_MS)
  const { data: searchedOption, error: searchError } = useSelectorOptionDetail(field.selectorKey, {
    context,
    detailId: isEnabled && debouncedSearch.length > 0 ? debouncedSearch : undefined,
  })

  /**
   * Resolve the *selected* value too, not just the typed one, so the trigger does
   * not fall back to a raw id for something just picked. Single-select only:
   * resolving N ids would need N hooks, so multi-select relies on the remembered
   * options below.
   */
  const singleValue = Array.isArray(value) ? value[0] : value
  const { data: selectedOption } = useSelectorOptionDetail(field.selectorKey, {
    context,
    detailId: !isMulti && isEnabled && singleValue ? singleValue : undefined,
  })

  const emptyMessage = getEmptyMessage(field.title.toLowerCase(), {
    error,
    lookupFailed: Boolean(searchError),
    hasMore,
    isFetchingMore,
    truncated,
  })

  /**
   * Resolved options are remembered for the lifetime of the field. Both lookups are
   * keyed on values that change — the search box clears on select and close, and a
   * multi-select field resolves no id at all (that would need one hook per id) — so
   * reading them directly would drop a label moments after it appeared, leaving the
   * trigger showing a raw id for something the user just picked.
   */
  const [resolvedOptions, setResolvedOptions] = useState<Record<string, string>>({})
  useEffect(() => {
    const found = [searchedOption, selectedOption].filter(Boolean) as SelectorOption[]
    if (found.length === 0) return
    setResolvedOptions((prev) => {
      let next = prev
      for (const option of found) {
        if (next[option.id] === option.label) continue
        if (next === prev) next = { ...prev }
        next[option.id] = option.label
      }
      return next
    })
  }, [searchedOption, selectedOption])

  const comboboxOptions = useMemo<ComboboxOption[]>(() => {
    const base = options.map((opt) => ({ label: opt.label, value: opt.id }))
    const seen = new Set(base.map((opt) => opt.value))
    const extras: ComboboxOption[] = []
    for (const [id, label] of Object.entries(resolvedOptions)) {
      if (seen.has(id)) continue
      seen.add(id)
      extras.push({ label, value: id })
    }
    return extras.length > 0 ? [...extras, ...base] : base
  }, [options, resolvedOptions])

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
        onMultiSelectChange={(values) => onChange(values)}
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
      onChange={(next) => onChange(next)}
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
    lookupFailed: boolean
    hasMore: boolean
    isFetchingMore: boolean
    truncated: boolean
  }
): string {
  // `field.title` is singular on some connectors ("Base") and plural on others
  // ("Spaces"), so only the settled message puts the noun behind a quantifier.
  if (state.error) return 'No match — the list failed to load. Try reopening'
  // Distinct from the list failing: the list is fine, resolving the typed value is not.
  if (state.lookupFailed) return 'No match — could not check that exact value'
  if (state.hasMore || state.isFetchingMore) return 'No match yet — still loading…'
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
