import type {
  OrganizationDataRetention,
  OrganizationRetentionValues,
  UpdateOrganizationDataRetentionBody,
} from '@/lib/api/contracts/organization'
import type { RetentionOverride } from '@/lib/api/contracts/primitives'

export const SETTINGS_PRIMARY_RETENTION_BASELINE = {
  logRetentionHours: 30 * 24,
  softDeleteRetentionHours: 90 * 24,
  taskCleanupHours: 30 * 24,
  piiRedaction: null,
  retentionOverrides: [],
} satisfies OrganizationRetentionValues

export const INHERITED_RETENTION_VALUE = 'inherit'
export const FOREVER_RETENTION_VALUE = 'never'

export type RetentionDayValue =
  | typeof INHERITED_RETENTION_VALUE
  | typeof FOREVER_RETENTION_VALUE
  | `${number}`

export interface RetentionOverrideDayValues {
  logRetention: RetentionDayValue
  softDeleteRetention: RetentionDayValue
  taskCleanup: RetentionDayValue
}

type RetentionUpdateFields = Pick<
  UpdateOrganizationDataRetentionBody,
  'logRetentionHours' | 'softDeleteRetentionHours' | 'taskCleanupHours' | 'retentionOverrides'
>

export function captureConfiguredRetention(
  retention: Pick<OrganizationDataRetention, 'configured'>
): OrganizationRetentionValues {
  return structuredClone(retention.configured)
}

/**
 * Builds the complete E2E retention PUT while deliberately omitting PII.
 * The E2E profile keeps PII redaction disabled, and including the key would
 * turn an unrelated retention update into a production 403.
 */
export function buildRetentionPutBody(
  snapshot: OrganizationRetentionValues,
  changes: Partial<RetentionUpdateFields> = {}
): UpdateOrganizationDataRetentionBody {
  const merged = { ...snapshot, ...structuredClone(changes) }
  const body: UpdateOrganizationDataRetentionBody = {
    logRetentionHours: merged.logRetentionHours,
    softDeleteRetentionHours: merged.softDeleteRetentionHours,
    taskCleanupHours: merged.taskCleanupHours,
  }
  if (merged.retentionOverrides !== null) {
    body.retentionOverrides = structuredClone(merged.retentionOverrides)
  }
  return body
}

export function retentionHoursToDayValue(
  hours: number | null | undefined,
  allowInherited: boolean
): RetentionDayValue {
  if (hours === undefined) {
    if (allowInherited) return INHERITED_RETENTION_VALUE
    throw new Error('Organization retention hours cannot be inherited')
  }
  if (hours === null) return FOREVER_RETENTION_VALUE
  if (!Number.isInteger(hours) || hours % 24 !== 0) {
    throw new Error(`Retention hours must be day-aligned, received ${hours}`)
  }
  return String(hours / 24) as `${number}`
}

export function retentionDayValueToHours(
  value: RetentionDayValue,
  allowInherited: boolean
): number | null | undefined {
  if (value === INHERITED_RETENTION_VALUE) {
    if (allowInherited) return undefined
    throw new Error('Organization retention cannot inherit a value')
  }
  if (value === FOREVER_RETENTION_VALUE) return null
  const days = Number(value)
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`Invalid retention day value: ${value}`)
  }
  return days * 24
}

export function retentionOverrideToDayValues(
  override: RetentionOverride
): RetentionOverrideDayValues {
  return {
    logRetention: retentionHoursToDayValue(override.logRetentionHours, true),
    softDeleteRetention: retentionHoursToDayValue(override.softDeleteRetentionHours, true),
    taskCleanup: retentionHoursToDayValue(override.taskCleanupHours, true),
  }
}

export function buildRetentionOverride(
  workspaceId: string,
  values: RetentionOverrideDayValues
): RetentionOverride {
  const override: RetentionOverride = { workspaceId }
  const fields = {
    logRetentionHours: retentionDayValueToHours(values.logRetention, true),
    softDeleteRetentionHours: retentionDayValueToHours(values.softDeleteRetention, true),
    taskCleanupHours: retentionDayValueToHours(values.taskCleanup, true),
  }
  if (fields.logRetentionHours !== undefined) {
    override.logRetentionHours = fields.logRetentionHours
  }
  if (fields.softDeleteRetentionHours !== undefined) {
    override.softDeleteRetentionHours = fields.softDeleteRetentionHours
  }
  if (fields.taskCleanupHours !== undefined) {
    override.taskCleanupHours = fields.taskCleanupHours
  }
  return override
}

export function assertSettingsPrimaryRetentionBaseline(actual: unknown, label: string): void {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    throw new Error(`${label} is not a retention settings object`)
  }
  const record = actual as Record<string, unknown>
  const expected = SETTINGS_PRIMARY_RETENTION_BASELINE as Record<string, unknown>
  const actualKeys = Object.keys(record).sort()
  const expectedKeys = Object.keys(expected).sort()
  if (
    JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys) ||
    expectedKeys.some((key) => JSON.stringify(record[key]) !== JSON.stringify(expected[key]))
  ) {
    throw new Error(`${label} does not match the exact settings-primary retention baseline`)
  }
}
