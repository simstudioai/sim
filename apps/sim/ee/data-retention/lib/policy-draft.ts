import { generateId } from '@sim/utils/id'
import type { UpdateOrganizationDataRetentionBody } from '@/lib/api/contracts/organization'
import type { RetentionOverride } from '@/lib/api/contracts/primitives'
import {
  type CustomPiiPattern,
  emptyPiiStages,
  isEntitySupportedForLanguage,
  PII_STAGES,
  type PIIEntityType,
  type PIILanguage,
  type PiiStageKey,
  type PiiStagePolicy,
  type PiiStages,
  sanitizeCustomPatterns,
  stripNerEntities,
} from '@/lib/guardrails/pii-entities'

/** Sentinel `RetentionSelect` value meaning "inherit the org-level value". */
const INHERIT = 'inherit'

const DAY_OPTIONS = [
  { value: '1', label: '1 day' },
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '1 year' },
  { value: '1825', label: '5 years' },
  { value: 'never', label: 'Forever' },
] as const

/** Choices for one retention field; a stored value outside the list stays selectable as itself. */
export function retentionSelectOptions(
  value: string,
  allowInherit: boolean
): { value: string; label: string }[] {
  const base = DAY_OPTIONS.map((o) => ({ value: o.value as string, label: o.label as string }))
  const withInherit = allowInherit
    ? [{ value: INHERIT, label: 'Inherit from organization' }, ...base]
    : base
  const isKnown = value === INHERIT || DAY_OPTIONS.some((o) => o.value === value)
  return isKnown ? withInherit : [...withInherit, { value, label: `${value} days (custom)` }]
}

interface PiiOverride {
  id: string
  workspaceId: string
  stages: PiiStages
}

/**
 * Unified editable shape for one retention policy — the organization default
 * (`isOrgDefault`) or a workspace override. Retention fields hold
 * `RetentionSelect` values; for overrides `INHERIT` means "use the org value".
 * `piiOverride` gates the PII grid (always on for the org default; toggled by
 * the inherit/override switch for workspace overrides).
 */
export interface PolicyDraft {
  isOrgDefault: boolean
  workspaceIds: string[]
  logDays: string
  softDeleteDays: string
  taskCleanupDays: string
  piiOverride: boolean
  piiStages: PiiStages
}

export interface EditingPolicy {
  draft: PolicyDraft
  original: PolicyDraft
  isNew: boolean
}

/** Everything one save writes: the route replaces each provided key, so all of it is always sent. */
export interface RetentionSnapshot {
  logDays: string
  softDeleteDays: string
  taskCleanupDays: string
  defaultPii: Omit<PiiOverride, 'workspaceId'> | null
  piiOverrides: PiiOverride[]
  overrides: RetentionOverride[]
}

/** Day bounds the retention contract accepts (1 day … 5 years). */
const MIN_RETENTION_DAYS = 1
const MAX_RETENTION_DAYS = 1825

/**
 * Hours → display days, clamped to the contract's range. Sub-day values would
 * otherwise round to `0` and be re-sent as `0`, wedging every save on the page.
 */
function clampDisplayDays(hours: number): string {
  const days = Math.round(hours / 24)
  return String(Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, days)))
}

/** Day count → hours. Throws rather than send a value the contract rejects. */
function toRetentionHours(days: string): number {
  const parsed = Number(days)
  if (!Number.isFinite(parsed) || parsed < MIN_RETENTION_DAYS) {
    throw new Error(`Invalid retention period: ${JSON.stringify(days)}`)
  }
  return Math.min(MAX_RETENTION_DAYS, Math.round(parsed)) * 24
}

export function hoursToDisplayDays(hours: number | null): string {
  if (hours === null) return 'never'
  return clampDisplayDays(hours)
}

function daysToHours(days: string): number | null {
  if (days === 'never') return null
  return toRetentionHours(days)
}

/** Override field: `INHERIT` ⇄ undefined, `'never'` ⇄ null (forever), day count ⇄ hours. */
function hoursToOverrideValue(hours: number | null | undefined): string {
  return hours === undefined ? INHERIT : hoursToDisplayDays(hours)
}

function overrideValueToHours(value: string): number | null | undefined {
  return value === INHERIT ? undefined : daysToHours(value)
}

/**
 * Builds a workspace override from the editable fields, starting from the override being replaced so
 * fields this form does not edit (such as the API-only `fileVersionRetentionHours`) survive a save.
 */
function buildRetentionOverride(
  workspaceId: string,
  draft: PolicyDraft,
  existing: RetentionOverride | undefined
): RetentionOverride | null {
  const override: RetentionOverride = { ...existing, workspaceId }
  const edited = {
    logRetentionHours: overrideValueToHours(draft.logDays),
    softDeleteRetentionHours: overrideValueToHours(draft.softDeleteDays),
    taskCleanupHours: overrideValueToHours(draft.taskCleanupDays),
  }
  for (const [field, hours] of Object.entries(edited) as [
    keyof typeof edited,
    number | null | undefined,
  ][]) {
    if (hours === undefined) delete override[field]
    else override[field] = hours
  }
  return Object.keys(override).length > 1 ? override : null
}

/** Stable serialization of a stage set for dirty-detection. */
function serializeStages(
  stages: PiiStages
): Array<[PiiStageKey, boolean, string[], PIILanguage, CustomPiiPattern[]]> {
  return PII_STAGES.map((key) => {
    const policy = stages[key]
    return [
      key,
      policy.enabled,
      [...policy.entityTypes].sort(),
      policy.language,
      policy.customPatterns ?? [],
    ] as [PiiStageKey, boolean, string[], PIILanguage, CustomPiiPattern[]]
  })
}

export function normalizePolicyDraft(draft: PolicyDraft): string {
  return JSON.stringify({
    isOrgDefault: draft.isOrgDefault,
    workspaceIds: [...draft.workspaceIds].sort(),
    logDays: draft.logDays,
    softDeleteDays: draft.softDeleteDays,
    taskCleanupDays: draft.taskCleanupDays,
    piiOverride: draft.piiOverride,
    piiStages: draft.piiOverride ? serializeStages(draft.piiStages) : [],
  })
}

/** A stage is "on" iff it has at least one entity type or custom pattern. */
export function stageHasContent(policy: PiiStagePolicy): boolean {
  return policy.entityTypes.length > 0 || (policy.customPatterns?.length ?? 0) > 0
}

function anyStageHasContent(stages: PiiStages): boolean {
  return PII_STAGES.some((key) => stageHasContent(stages[key]))
}

/** Persist-time guarantee that `enabled` mirrors "has content" for every stage. */
function withSyncedEnabled(stages: PiiStages): PiiStages {
  return PII_STAGES.reduce((acc, key) => {
    // Block outputs are regex-only — strip any NER before persisting.
    const entityTypes =
      key === 'blockOutputs' ? stripNerEntities(stages[key].entityTypes) : stages[key].entityTypes
    // Drop half-typed rows (empty regex) so the boundary contract never rejects the save.
    const customPatterns = sanitizeCustomPatterns(stages[key].customPatterns)
    acc[key] = {
      ...stages[key],
      entityTypes,
      customPatterns,
      enabled: entityTypes.length > 0 || customPatterns.length > 0,
    }
    return acc
  }, {} as PiiStages)
}

/** Prune entity selections that the chosen language has no recognizer for. */
export function pruneEntitiesForLanguage(entityTypes: string[], language: PIILanguage): string[] {
  return entityTypes.filter((t) => isEntitySupportedForLanguage(t as PIIEntityType, language))
}

/** A stage after an edit: `enabled` always follows whether it has anything to redact. */
export function updateStagePolicy(
  policy: PiiStagePolicy,
  patch: Partial<PiiStagePolicy>
): PiiStagePolicy {
  const merged = { ...policy, ...patch }
  return { ...merged, enabled: stageHasContent(merged) }
}

/** Row-summary fragment, e.g. "Input 3 · Outputs off · Logs 5". */
function stageSummary(stages: PiiStages): string {
  const short: Record<PiiStageKey, string> = {
    input: 'Input',
    blockOutputs: 'Outputs',
    logs: 'Logs',
  }
  return PII_STAGES.map((key) => {
    const policy = stages[key]
    const count = policy.entityTypes.length + (policy.customPatterns?.length ?? 0)
    return `${short[key]} ${stageHasContent(policy) ? count : 'off'}`
  }).join(' · ')
}

/** Row-summary label for a retention field driven by stored hours. */
function retentionLabel(hours: number | null | undefined): string {
  if (hours === undefined) return 'inherited'
  if (hours === null) return 'forever'
  return `${Math.round(hours / 24)}d`
}

/** Row-summary label for a retention field driven by a `RetentionSelect` day value. */
function dayValueLabel(days: string): string {
  if (days === 'never') return 'forever'
  if (!days) return '—'
  return `${days}d`
}

export function orgPolicySummary(snapshot: RetentionSnapshot): string {
  const { defaultPii } = snapshot
  return [
    `Log ${dayValueLabel(snapshot.logDays)}`,
    `Soft-delete ${dayValueLabel(snapshot.softDeleteDays)}`,
    `Task ${dayValueLabel(snapshot.taskCleanupDays)}`,
    defaultPii && anyStageHasContent(defaultPii.stages)
      ? `PII: ${stageSummary(defaultPii.stages)}`
      : 'No PII',
  ].join(' · ')
}

export function overridePolicySummary(snapshot: RetentionSnapshot, workspaceId: string): string {
  const ov = snapshot.overrides.find((o) => o.workspaceId === workspaceId)
  const pii = snapshot.piiOverrides.find((p) => p.workspaceId === workspaceId)
  return [
    `Log ${retentionLabel(ov?.logRetentionHours)}`,
    `Soft-delete ${retentionLabel(ov?.softDeleteRetentionHours)}`,
    `Task ${retentionLabel(ov?.taskCleanupHours)}`,
    pii ? `PII: ${stageSummary(pii.stages)}` : 'PII inherited',
  ].join(' · ')
}

/** The whole document one save sends. */
export function buildRetentionUpdate(next: RetentionSnapshot): UpdateOrganizationDataRetentionBody {
  const rules: { id: string; workspaceId: string | null; stages: PiiStages }[] =
    next.piiOverrides.map((p) => ({
      id: p.id,
      workspaceId: p.workspaceId,
      stages: withSyncedEnabled(p.stages),
    }))
  if (next.defaultPii) {
    rules.unshift({
      id: next.defaultPii.id,
      workspaceId: null,
      stages: withSyncedEnabled(next.defaultPii.stages),
    })
  }
  return {
    logRetentionHours: daysToHours(next.logDays),
    softDeleteRetentionHours: daysToHours(next.softDeleteDays),
    taskCleanupHours: daysToHours(next.taskCleanupDays),
    retentionOverrides: next.overrides,
    piiRedaction: { rules },
  }
}

export function orgPolicyDraft(snapshot: RetentionSnapshot): PolicyDraft {
  return {
    isOrgDefault: true,
    workspaceIds: [],
    logDays: snapshot.logDays,
    softDeleteDays: snapshot.softDeleteDays,
    taskCleanupDays: snapshot.taskCleanupDays,
    piiOverride: true,
    piiStages: snapshot.defaultPii?.stages ?? emptyPiiStages(),
  }
}

export function newOverrideDraft(): PolicyDraft {
  return {
    isOrgDefault: false,
    workspaceIds: [],
    logDays: INHERIT,
    softDeleteDays: INHERIT,
    taskCleanupDays: INHERIT,
    piiOverride: false,
    piiStages: emptyPiiStages(),
  }
}

export function overrideDraft(snapshot: RetentionSnapshot, workspaceId: string): PolicyDraft {
  const ov = snapshot.overrides.find((o) => o.workspaceId === workspaceId)
  const pii = snapshot.piiOverrides.find((p) => p.workspaceId === workspaceId)
  return {
    isOrgDefault: false,
    workspaceIds: [workspaceId],
    logDays: hoursToOverrideValue(ov?.logRetentionHours),
    softDeleteDays: hoursToOverrideValue(ov?.softDeleteRetentionHours),
    taskCleanupDays: hoursToOverrideValue(ov?.taskCleanupHours),
    piiOverride: Boolean(pii),
    piiStages: pii?.stages ?? emptyPiiStages(),
  }
}

/** The snapshot after saving the organization defaults: empty redaction stores no rule at all. */
export function withOrgPolicy(snapshot: RetentionSnapshot, draft: PolicyDraft): RetentionSnapshot {
  return {
    ...snapshot,
    logDays: draft.logDays,
    softDeleteDays: draft.softDeleteDays,
    taskCleanupDays: draft.taskCleanupDays,
    defaultPii: anyStageHasContent(draft.piiStages)
      ? { id: snapshot.defaultPii?.id ?? generateId(), stages: draft.piiStages }
      : null,
  }
}

/** The snapshot after saving a workspace override, which may have moved to other workspaces. */
export function withOverridePolicy(
  snapshot: RetentionSnapshot,
  editing: EditingPolicy
): RetentionSnapshot {
  const { draft, original } = editing
  const ids = draft.workspaceIds
  const clearIds = new Set([...original.workspaceIds, ...ids])
  const nextOverrides = snapshot.overrides.filter((o) => !clearIds.has(o.workspaceId))
  const nextPiiOverrides = snapshot.piiOverrides.filter((p) => !clearIds.has(p.workspaceId))
  /** An edited override moved to another workspace keeps what only the API can set. */
  const replacedOverride =
    original.workspaceIds.length === 1
      ? snapshot.overrides.find((o) => o.workspaceId === original.workspaceIds[0])
      : undefined
  for (const workspaceId of ids) {
    const ov = buildRetentionOverride(
      workspaceId,
      draft,
      snapshot.overrides.find((o) => o.workspaceId === workspaceId) ?? replacedOverride
    )
    if (ov) nextOverrides.push(ov)
    if (draft.piiOverride) {
      const existing = snapshot.piiOverrides.find((p) => p.workspaceId === workspaceId)
      nextPiiOverrides.push({
        id: existing?.id ?? generateId(),
        workspaceId,
        stages: draft.piiStages,
      })
    }
  }
  return { ...snapshot, overrides: nextOverrides, piiOverrides: nextPiiOverrides }
}

/** The snapshot after removing an override from the workspaces it originally covered. */
export function withoutOverride(
  snapshot: RetentionSnapshot,
  workspaceIds: readonly string[]
): RetentionSnapshot {
  const idSet = new Set(workspaceIds)
  return {
    ...snapshot,
    overrides: snapshot.overrides.filter((o) => !idSet.has(o.workspaceId)),
    piiOverrides: snapshot.piiOverrides.filter((p) => !idSet.has(p.workspaceId)),
  }
}

/** Every workspace holding an override of either kind. */
export function overrideWorkspaceIds(snapshot: RetentionSnapshot): string[] {
  return Array.from(
    new Set([
      ...snapshot.overrides.map((o) => o.workspaceId),
      ...snapshot.piiOverrides.map((p) => p.workspaceId),
    ])
  )
}
