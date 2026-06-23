import type { DataRetentionSettings } from '@sim/db/schema'
import { coercePiiLanguage, DEFAULT_PII_LANGUAGE } from '@/lib/guardrails/pii-entities'

export interface EffectivePiiRedaction {
  enabled: boolean
  /** Presidio entity types to mask. Empty = redact all detected PII. */
  entityTypes: string[]
  /** Language whose Presidio recognizers apply when masking. */
  language: string
}

export const DEFAULT_PII_REDACTION: EffectivePiiRedaction = {
  enabled: false,
  entityTypes: [],
  language: DEFAULT_PII_LANGUAGE,
}

/**
 * Resolve the effective PII redaction policy for a workspace from the org-level
 * rules list, most-specific-wins (never unioned): the workspace's own rule takes
 * precedence over the all-workspaces rule (`workspaceId: null`). A resolved rule
 * with no entity types redacts nothing — so a workspace-specific empty rule
 * exempts that workspace, overriding the all rule. Defensive about the
 * loosely-typed JSON column.
 */
export function resolveEffectivePiiRedaction(params: {
  orgSettings: DataRetentionSettings | null | undefined
  workspaceId: string
}): EffectivePiiRedaction {
  const rules = params.orgSettings?.piiRedaction?.rules
  if (!Array.isArray(rules) || rules.length === 0) return DEFAULT_PII_REDACTION

  const rule =
    rules.find((r) => r?.workspaceId === params.workspaceId) ??
    rules.find((r) => r?.workspaceId == null)

  const types = Array.isArray(rule?.entityTypes)
    ? rule.entityTypes.filter((t): t is string => typeof t === 'string')
    : []
  if (types.length === 0) return DEFAULT_PII_REDACTION
  const language = coercePiiLanguage(rule?.language) ?? DEFAULT_PII_LANGUAGE
  return { enabled: true, entityTypes: types, language }
}
