'use client'

import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { Combobox, type ComboboxOption } from '@/components/emcn'
import { SELECTOR_CONTEXT_FIELDS } from '@/lib/workflows/subblocks/context'
import { getDependsOnFields } from '@/blocks/utils'
import type { ConnectorConfigField } from '@/connectors/types'
import type { SelectorContext, SelectorKey } from '@/hooks/selectors/types'
import { useSelectorOptions } from '@/hooks/selectors/use-selector-query'

interface ConnectorSelectorFieldProps {
  field: ConnectorConfigField & { selectorKey: SelectorKey }
  value: string
  onChange: (value: string) => void
  credentialId: string | null
  sourceConfig: Record<string, string>
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
      <div className='flex items-center gap-2 rounded-sm border border-[var(--border-1)] bg-[var(--surface-5)] px-2 py-1.5 text-[var(--text-muted)] text-sm'>
        <Loader2 className='h-3.5 w-3.5 animate-spin' />
        Loading...
      </div>
    )
  }

  return (
    <Combobox
      options={comboboxOptions}
      value={value || undefined}
      onChange={onChange}
      placeholder={
        !credentialId
          ? 'Connect an account first'
          : !depsResolved
            ? `Select ${getDependencyLabel(field, configFields)} first`
            : field.placeholder || `Select ${field.title.toLowerCase()}`
      }
      disabled={disabled || !credentialId || !depsResolved}
    />
  )
}

function resolveDepValue(
  depFieldId: string,
  configFields: ConnectorConfigField[],
  canonicalModes: Record<string, 'basic' | 'advanced'>,
  sourceConfig: Record<string, string>
): string {
  const depField = configFields.find((f) => f.id === depFieldId)
  if (!depField?.canonicalParamId) return sourceConfig[depFieldId] ?? ''

  const activeMode = canonicalModes[depField.canonicalParamId] ?? 'basic'
  if (depField.mode === activeMode) return sourceConfig[depFieldId] ?? ''

  const activeField = configFields.find(
    (f) => f.canonicalParamId === depField.canonicalParamId && f.mode === activeMode
  )
  return activeField ? (sourceConfig[activeField.id] ?? '') : (sourceConfig[depFieldId] ?? '')
}

function getDependencyLabel(
  field: ConnectorConfigField,
  configFields: ConnectorConfigField[]
): string {
  const deps = getDependsOnFields(field.dependsOn)
  const depField = deps.length > 0 ? configFields.find((f) => f.id === deps[0]) : undefined
  return depField?.title?.toLowerCase() ?? 'dependency'
}
