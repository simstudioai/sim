import type { DataRetentionSettings, PiiStagePolicy } from '@sim/db/schema'
import { coercePiiLanguage, DEFAULT_PII_LANGUAGE } from '@/lib/guardrails/pii-entities'

/** Resolved policy for one redaction stage. */
export interface EffectivePiiStage {
  enabled: boolean
  /** Presidio entity types to mask. Empty = redact all detected PII. */
  entityTypes: string[]
  /** Language whose Presidio recognizers apply when masking. */
  language: string
}

/**
 * Effective PII redaction, resolved per stage. `input`/`blockOutputs` are
 * execution-altering (mask the data the workflow computes on); `logs` is the
 * observability-only persist-time stage.
 */
export interface EffectivePiiRedaction {
  input: EffectivePiiStage
  blockOutputs: EffectivePiiStage
  logs: EffectivePiiStage
}

const DISABLED_STAGE: EffectivePiiStage = {
  enabled: false,
  entityTypes: [],
  language: DEFAULT_PII_LANGUAGE,
}

export const DEFAULT_PII_REDACTION: EffectivePiiRedaction = {
  input: DISABLED_STAGE,
  blockOutputs: DISABLED_STAGE,
  logs: DISABLED_STAGE,
}

function sanitizeEntityTypes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : []
}

/** A stage redacts nothing unless it is enabled AND has at least one entity type. */
function toEffectiveStage(policy: PiiStagePolicy | undefined): EffectivePiiStage {
  const types = sanitizeEntityTypes(policy?.entityTypes)
  if (!policy?.enabled || types.length === 0) return DISABLED_STAGE
  return {
    enabled: true,
    entityTypes: types,
    language: coercePiiLanguage(policy.language) ?? DEFAULT_PII_LANGUAGE,
  }
}

/**
 * Resolve the effective per-stage PII redaction policy for a workspace from the
 * org-level rules list, most-specific-wins (never unioned): the workspace's own
 * rule takes precedence over the all-workspaces rule (`workspaceId: null`). Rule
 * selection is whole-rule; the selected rule is then expanded into three stages.
 *
 * Back-compat: a legacy rule with no `stages` is treated exactly as it was before
 * — logs-only, masking its flat `entityTypes` (input/blockOutputs disabled). A
 * resolved stage with no entity types redacts nothing. Defensive about the
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
  if (!rule) return DEFAULT_PII_REDACTION

  if (!rule.stages) {
    const types = sanitizeEntityTypes(rule.entityTypes)
    if (types.length === 0) return DEFAULT_PII_REDACTION
    return {
      input: DISABLED_STAGE,
      blockOutputs: DISABLED_STAGE,
      logs: {
        enabled: true,
        entityTypes: types,
        language: coercePiiLanguage(rule.language) ?? DEFAULT_PII_LANGUAGE,
      },
    }
  }

  return {
    input: toEffectiveStage(rule.stages.input),
    blockOutputs: toEffectiveStage(rule.stages.blockOutputs),
    logs: toEffectiveStage(rule.stages.logs),
  }
}

export type RetentionHoursKey =
  | 'logRetentionHours'
  | 'softDeleteRetentionHours'
  | 'taskCleanupHours'

/**
 * Resolve the effective retention hours for one workspace and job type. A
 * workspace override wins when it sets the field (a number, or `null` for
 * forever); an omitted field inherits the org-level value. Returns `null` when
 * nothing is configured (the dispatcher treats `null` as "skip").
 */
export function resolveEffectiveRetentionHours(params: {
  orgSettings: DataRetentionSettings | null | undefined
  workspaceId: string
  key: RetentionHoursKey
}): number | null {
  const override = params.orgSettings?.retentionOverrides?.find(
    (o) => o?.workspaceId === params.workspaceId
  )
  const overrideValue = override?.[params.key]
  if (overrideValue !== undefined) return overrideValue
  return params.orgSettings?.[params.key] ?? null
}
