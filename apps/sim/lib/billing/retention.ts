import type { DataRetentionSettings } from '@sim/db/schema'

export interface EffectivePiiRedaction {
  enabled: boolean
  /** Presidio entity types to mask. Empty = redact all detected PII. */
  entityTypes: string[]
}

export const DEFAULT_PII_REDACTION: EffectivePiiRedaction = {
  enabled: false,
  entityTypes: [],
}

/**
 * Resolve the effective PII redaction policy for a workspace from the org-level
 * rules list: the entity types of every rule targeting the workspace are
 * unioned. A rule with no entity types selected redacts nothing (it contributes
 * nothing to the union), so an empty effective set means "redact nothing" —
 * never "redact everything". Defensive about the loosely-typed JSON column.
 */
export function resolveEffectivePiiRedaction(params: {
  orgSettings: DataRetentionSettings | null | undefined
  workspaceId: string
}): EffectivePiiRedaction {
  const rules = params.orgSettings?.piiRedaction?.rules
  if (!Array.isArray(rules) || rules.length === 0) return DEFAULT_PII_REDACTION

  const applicable = rules.filter(
    (rule) =>
      rule?.appliesToAllWorkspaces === true ||
      (Array.isArray(rule?.workspaceIds) && rule.workspaceIds.includes(params.workspaceId))
  )

  const union = new Set<string>()
  for (const rule of applicable) {
    if (!Array.isArray(rule.entityTypes)) continue
    for (const t of rule.entityTypes) {
      if (typeof t === 'string') union.add(t)
    }
  }
  if (union.size === 0) return DEFAULT_PII_REDACTION
  return { enabled: true, entityTypes: [...union] }
}
