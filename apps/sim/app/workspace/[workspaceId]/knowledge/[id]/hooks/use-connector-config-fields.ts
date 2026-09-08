'use client'

import { useCallback, useMemo, useState } from 'react'
import type { ConnectorAccessMode } from '@/lib/knowledge/connectors/access-modes'
import {
  createSourceLabelMetadata,
  normalizeSourceSelectionLabels,
  SOURCE_LABELS_KEY,
  type SourceSelectionLabel,
  type SourceSelectionLabels,
} from '@/lib/sim-search/source-identity'
import { getDependsOnFields } from '@/lib/workflows/subblocks/dependencies'
import type { ConnectorConfigField, ConnectorMeta } from '@/connectors/types'

export type ConfigFieldValue = string | string[]
export type ConfigFieldMap = Record<string, ConfigFieldValue>

export interface UseConnectorConfigFieldsOptions {
  connectorConfig: ConnectorMeta | null
  accessMode?: ConnectorAccessMode
  initialSourceConfig?: ConfigFieldMap
  initialCanonicalModes?: Record<string, 'basic' | 'advanced'>
  initialSelectionLabels?: SourceSelectionLabels
}

export interface UseConnectorConfigFieldsResult {
  sourceConfig: ConfigFieldMap
  selectionLabels: SourceSelectionLabels
  setSourceConfig: React.Dispatch<React.SetStateAction<ConfigFieldMap>>
  canonicalModes: Record<string, 'basic' | 'advanced'>
  setCanonicalModes: React.Dispatch<React.SetStateAction<Record<string, 'basic' | 'advanced'>>>
  canonicalGroups: Map<string, ConnectorConfigField[]>
  isFieldVisible: (field: ConnectorConfigField) => boolean
  isFieldPopulated: (field: ConnectorConfigField) => boolean
  handleFieldChange: (
    fieldId: string,
    value: ConfigFieldValue,
    selectedOptions?: SourceSelectionLabel[]
  ) => void
  toggleCanonicalMode: (canonicalId: string) => void
  resolveSourceConfig: () => Record<string, unknown>
}

function isMultiField(field: ConnectorConfigField | undefined): boolean {
  return Boolean(field?.multi)
}

function emptyValue(field: ConnectorConfigField | undefined): ConfigFieldValue {
  return isMultiField(field) ? [] : ''
}

/**
 * Coerces a stored value to the shape expected by the field (string vs string[]).
 * Multi fields accept either a string[] or a CSV string from advanced mode.
 */
function coerceForField(field: ConnectorConfigField, raw: unknown): ConfigFieldValue {
  if (isMultiField(field)) {
    if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string')
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (!trimmed) return []
      return trimmed.split(',').flatMap((s) => {
        const t = s.trim()
        return t ? [t] : []
      })
    }
    return []
  }
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string').join(',')
  }
  return raw == null ? '' : String(raw)
}

function isValuePopulated(value: ConfigFieldValue): boolean {
  if (Array.isArray(value)) return value.length > 0
  return value.trim().length > 0
}

/**
 * Shared state and helpers for connector configuration fields that support
 * canonical pairs (selector + manual input sharing a `canonicalParamId`) and
 * multi-value fields (selector or short-input with `multi: true`).
 */
export function useConnectorConfigFields({
  connectorConfig,
  accessMode = 'workspace',
  initialSourceConfig,
  initialCanonicalModes,
  initialSelectionLabels,
}: UseConnectorConfigFieldsOptions): UseConnectorConfigFieldsResult {
  const [sourceConfig, setFieldValues] = useState<ConfigFieldMap>(() => initialSourceConfig ?? {})
  const [selectionLabels, setSelectionLabels] = useState(() =>
    normalizeSourceSelectionLabels(initialSelectionLabels)
  )
  const setSourceConfig = useCallback<React.Dispatch<React.SetStateAction<ConfigFieldMap>>>(
    (value) => {
      setFieldValues(value)
      setSelectionLabels({})
    },
    []
  )
  const [selectedCanonicalModes, setCanonicalModes] = useState<
    Record<string, 'basic' | 'advanced'>
  >(() => initialCanonicalModes ?? {})

  const canonicalGroups = useMemo(() => {
    const groups = new Map<string, ConnectorConfigField[]>()
    if (!connectorConfig) return groups
    for (const field of connectorConfig.configFields) {
      if (accessMode === 'members' && field.hideInMemberMode) continue
      if (!field.canonicalParamId) continue
      const existing = groups.get(field.canonicalParamId)
      if (existing) existing.push(field)
      else groups.set(field.canonicalParamId, [field])
    }
    return groups
  }, [connectorConfig, accessMode])

  const canonicalModes = useMemo(() => {
    const modes = { ...selectedCanonicalModes }
    for (const [canonicalId, fields] of canonicalGroups) {
      const selected = modes[canonicalId] ?? 'basic'
      modes[canonicalId] = fields.some((field) => field.mode === selected)
        ? selected
        : (fields[0]?.mode ?? 'basic')
    }
    return modes
  }, [selectedCanonicalModes, canonicalGroups])

  const fieldsById = useMemo(() => {
    const map = new Map<string, ConnectorConfigField>()
    if (!connectorConfig) return map
    for (const field of connectorConfig.configFields) map.set(field.id, field)
    return map
  }, [connectorConfig])

  const dependentFieldIds = useMemo(() => {
    const result = new Map<string, string[]>()
    if (!connectorConfig) return result

    const map = new Map<string, Set<string>>()
    for (const field of connectorConfig.configFields) {
      const deps = getDependsOnFields(field.dependsOn)
      for (const dep of deps) {
        const existing = map.get(dep) ?? new Set<string>()
        existing.add(field.id)
        if (field.canonicalParamId) {
          for (const sibling of canonicalGroups.get(field.canonicalParamId) ?? []) {
            existing.add(sibling.id)
          }
        }
        map.set(dep, existing)
      }
    }
    for (const group of canonicalGroups.values()) {
      const allDependents = new Set<string>()
      for (const field of group) {
        for (const dep of map.get(field.id) ?? []) {
          allDependents.add(dep)
          const depField = fieldsById.get(dep)
          if (depField?.canonicalParamId) {
            for (const sibling of canonicalGroups.get(depField.canonicalParamId) ?? []) {
              allDependents.add(sibling.id)
            }
          }
        }
      }
      if (allDependents.size > 0) {
        for (const field of group) map.set(field.id, new Set(allDependents))
      }
    }
    for (const [key, value] of map) result.set(key, [...value])
    return result
  }, [connectorConfig, canonicalGroups, fieldsById])

  const isFieldVisible = useCallback(
    (field: ConnectorConfigField): boolean => {
      if (accessMode === 'members' && field.hideInMemberMode) return false
      if (!field.canonicalParamId || !field.mode) return true
      const activeMode = canonicalModes[field.canonicalParamId] ?? 'basic'
      return field.mode === activeMode
    },
    [canonicalModes, accessMode]
  )

  const isFieldPopulated = useCallback(
    (field: ConnectorConfigField): boolean =>
      isValuePopulated(sourceConfig[field.id] ?? emptyValue(field)),
    [sourceConfig]
  )

  const handleFieldChange = useCallback(
    (fieldId: string, value: ConfigFieldValue, selectedOptions?: SourceSelectionLabel[]) => {
      setFieldValues((prev) => {
        const next: ConfigFieldMap = { ...prev, [fieldId]: value }
        const toClear = dependentFieldIds.get(fieldId)
        if (toClear) {
          for (const depId of toClear) next[depId] = emptyValue(fieldsById.get(depId))
        }
        return next
      })
      setSelectionLabels((prev) => {
        const next = { ...prev }
        for (const id of [fieldId, ...(dependentFieldIds.get(fieldId) ?? [])]) {
          delete next[fieldsById.get(id)?.canonicalParamId ?? id]
        }
        const canonicalId = fieldsById.get(fieldId)?.canonicalParamId ?? fieldId
        return {
          ...next,
          ...normalizeSourceSelectionLabels({ [canonicalId]: selectedOptions }),
        }
      })
    },
    [dependentFieldIds, fieldsById]
  )

  const toggleCanonicalMode = useCallback((canonicalId: string) => {
    setSelectionLabels((prev) => {
      const next = { ...prev }
      delete next[canonicalId]
      return next
    })
    setCanonicalModes((prev) => ({
      ...prev,
      [canonicalId]: prev[canonicalId] === 'advanced' ? 'basic' : 'advanced',
    }))
  }, [])

  const resolveSourceConfig = useCallback((): Record<string, unknown> => {
    const resolved: Record<string, unknown> = {}
    const processed = new Set<string>()
    if (!connectorConfig) return resolved

    for (const field of connectorConfig.configFields) {
      if (field.canonicalParamId) {
        if (processed.has(field.canonicalParamId)) continue
        processed.add(field.canonicalParamId)
        const group = canonicalGroups.get(field.canonicalParamId)
        if (!group) continue
        const activeMode = canonicalModes[field.canonicalParamId] ?? 'basic'
        const activeField = group.find((f) => f.mode === activeMode) ?? group[0]
        const raw = sourceConfig[activeField.id] ?? emptyValue(activeField)
        resolved[field.canonicalParamId] = coerceForField(activeField, raw)
      } else {
        const raw = sourceConfig[field.id] ?? emptyValue(field)
        resolved[field.id] = coerceForField(field, raw)
      }
    }
    resolved[SOURCE_LABELS_KEY] =
      createSourceLabelMetadata(connectorConfig, resolved, selectionLabels) ?? null
    return resolved
  }, [connectorConfig, canonicalGroups, canonicalModes, sourceConfig, selectionLabels])

  return {
    sourceConfig,
    selectionLabels,
    setSourceConfig,
    canonicalModes,
    setCanonicalModes,
    canonicalGroups,
    isFieldVisible,
    isFieldPopulated,
    handleFieldChange,
    toggleCanonicalMode,
    resolveSourceConfig,
  }
}
