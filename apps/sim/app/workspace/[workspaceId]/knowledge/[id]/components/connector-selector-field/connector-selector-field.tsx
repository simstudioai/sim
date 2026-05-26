'use client'

import { useMemo } from 'react'
import { Combobox, type ComboboxOption, Loader } from '@/components/emcn'
import { SELECTOR_CONTEXT_FIELDS } from '@/lib/workflows/subblocks/context'
import type {
  ConfigFieldMap,
  ConfigFieldValue,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { getDependsOnFields } from '@/blocks/utils'
import type { ConnectorConfigField } from '@/connectors/types'
import type { SelectorContext, SelectorKey } from '@/hooks/selectors/types'
import { useSelectorOptions } from '@/hooks/selectors/use-selector-query'

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

  const context = useMemo<SelectorContext>(() => {
    const ctx: SelectorContext = {}
    if (credentialId) ctx.oauthCredential = credentialId

    for (const depFieldId of getDependsOnFields(field.dependsOn)) {
      const depField = configFields.find((f) => f.id === depFieldId)
      const canonicalId = depField?.canonicalParamId ?? depFieldId
      const depValue = resolveDepValue(depFieldId, configFields, canonicalModes, sourceConfig)
      if (depValue && SELECTOR_CONTEXT_FIELDS.has(canonicalId as keyof SelectorContext)) {
        ctx[canonicalId as keyof SelectorContext] = depValue
      }
    }

    return ctx
  }, [credentialId, field.dependsOn, sourceConfig, configFields, canonicalModes])

  const depsResolved = useMemo(() => {
    if (!field.dependsOn) return true
    const deps = Array.isArray(field.dependsOn) ? field.dependsOn : (field.dependsOn.all ?? [])
    return deps.every((depId) =>
      Boolean(resolveDepValue(depId, configFields, canonicalModes, sourceConfig)?.trim())
    )
  }, [field.dependsOn, sourceConfig, configFields, canonicalModes])

  const isEnabled = !disabled && !!credentialId && depsResolved
  const { data: options = [], isLoading } = useSelectorOptions(field.selectorKey, {
    context,
    enabled: isEnabled,
  })

  const comboboxOptions = useMemo<ComboboxOption[]>(
    () => options.map((opt) => ({ label: opt.label, value: opt.id })),
    [options]
  )

  if (isLoading && isEnabled) {
    return (
      <div className='flex items-center gap-2 rounded-sm border border-[var(--border-1)] bg-[var(--surface-5)] px-2 py-1.5 font-medium text-[var(--text-muted)] text-small'>
        <Loader className='size-3.5' animate />
        Loading…
      </div>
    )
  }

  if (isMulti) {
    const multiValues = Array.isArray(value) ? value : value ? [value] : []
    return (
      <Combobox
        multiSelect
        options={comboboxOptions}
        multiSelectValues={multiValues}
        onMultiSelectChange={(values) => onChange(values)}
        searchable
        searchPlaceholder={`Search ${field.title.toLowerCase()}...`}
        placeholder={
          !credentialId
            ? 'Connect an account first'
            : !depsResolved
              ? `Select ${getDependencyLabel(field, configFields)} first`
              : field.placeholder || `Select ${field.title.toLowerCase()}`
        }
        disabled={disabled || !credentialId || !depsResolved}
        emptyMessage={`No ${field.title.toLowerCase()} found`}
      />
    )
  }

  const singleValue = Array.isArray(value) ? value[0] : value
  return (
    <Combobox
      options={comboboxOptions}
      value={singleValue || undefined}
      onChange={(next) => onChange(next)}
      searchable
      searchPlaceholder={`Search ${field.title.toLowerCase()}...`}
      placeholder={
        !credentialId
          ? 'Connect an account first'
          : !depsResolved
            ? `Select ${getDependencyLabel(field, configFields)} first`
            : field.placeholder || `Select ${field.title.toLowerCase()}`
      }
      disabled={disabled || !credentialId || !depsResolved}
      emptyMessage={`No ${field.title.toLowerCase()} found`}
    />
  )
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
