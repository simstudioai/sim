'use client'

import { useCallback, useMemo, useState } from 'react'
import { getDependsOnFields } from '@/blocks/utils'
import type { ConnectorConfig, ConnectorConfigField } from '@/connectors/types'

export interface UseConnectorConfigFieldsOptions {
  connectorConfig: ConnectorConfig | null
  initialSourceConfig?: Record<string, string>
}

export interface UseConnectorConfigFieldsResult {
  sourceConfig: Record<string, string>
  setSourceConfig: React.Dispatch<React.SetStateAction<Record<string, string>>>
  canonicalModes: Record<string, 'basic' | 'advanced'>
  setCanonicalModes: React.Dispatch<React.SetStateAction<Record<string, 'basic' | 'advanced'>>>
  canonicalGroups: Map<string, ConnectorConfigField[]>
  isFieldVisible: (field: ConnectorConfigField) => boolean
  handleFieldChange: (fieldId: string, value: string) => void
  toggleCanonicalMode: (canonicalId: string) => void
  resolveSourceConfig: () => Record<string, string>
}

/**
 * Shared state and helpers for connector configuration fields that support
 * canonical pairs (selector + manual input sharing a `canonicalParamId`).
 *
 * - Tracks current field values and active mode (basic/advanced) per canonical group.
 * - Computes the dependency graph including canonical-sibling expansion so that
 *   changing a dependency clears both siblings of any dependent canonical pair.
 * - Returns `resolveSourceConfig` which collapses the per-field map back to a
 *   canonical-keyed object ready to submit.
 */
export function useConnectorConfigFields({
  connectorConfig,
  initialSourceConfig,
}: UseConnectorConfigFieldsOptions): UseConnectorConfigFieldsResult {
  const [sourceConfig, setSourceConfig] = useState<Record<string, string>>(
    () => initialSourceConfig ?? {}
  )
  const [canonicalModes, setCanonicalModes] = useState<Record<string, 'basic' | 'advanced'>>({})

  const canonicalGroups = useMemo(() => {
    const groups = new Map<string, ConnectorConfigField[]>()
    if (!connectorConfig) return groups
    for (const field of connectorConfig.configFields) {
      if (!field.canonicalParamId) continue
      const existing = groups.get(field.canonicalParamId)
      if (existing) existing.push(field)
      else groups.set(field.canonicalParamId, [field])
    }
    return groups
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
          const depField = connectorConfig.configFields.find((f) => f.id === dep)
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
  }, [connectorConfig, canonicalGroups])

  const isFieldVisible = useCallback(
    (field: ConnectorConfigField): boolean => {
      if (!field.canonicalParamId || !field.mode) return true
      const activeMode = canonicalModes[field.canonicalParamId] ?? 'basic'
      return field.mode === activeMode
    },
    [canonicalModes]
  )

  const handleFieldChange = (fieldId: string, value: string) => {
    setSourceConfig((prev) => {
      const next = { ...prev, [fieldId]: value }
      const toClear = dependentFieldIds.get(fieldId)
      if (toClear) {
        for (const depId of toClear) next[depId] = ''
      }
      return next
    })
  }

  const toggleCanonicalMode = (canonicalId: string) => {
    setCanonicalModes((prev) => ({
      ...prev,
      [canonicalId]: prev[canonicalId] === 'advanced' ? 'basic' : 'advanced',
    }))
  }

  const resolveSourceConfig = useCallback((): Record<string, string> => {
    const resolved: Record<string, string> = {}
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
        resolved[field.canonicalParamId] = sourceConfig[activeField.id] ?? ''
      } else {
        resolved[field.id] = sourceConfig[field.id] ?? ''
      }
    }
    return resolved
  }, [connectorConfig, canonicalGroups, canonicalModes, sourceConfig])

  return {
    sourceConfig,
    setSourceConfig,
    canonicalModes,
    setCanonicalModes,
    canonicalGroups,
    isFieldVisible,
    handleFieldChange,
    toggleCanonicalMode,
    resolveSourceConfig,
  }
}
