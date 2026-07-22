import type { UpdateOrganizationDataRetentionBody } from '@/lib/api/contracts/organization'
import type { PiiRedactionSettings, RetentionOverride } from '@/lib/api/contracts/primitives'

export type DataRetentionState = 'loading' | 'error' | 'ready'

export interface DataRetentionQueryReadiness {
  retentionSuccess: boolean
  retentionError: boolean
  retentionPlaceholder: boolean
  workspacesSuccess: boolean
  workspacesError: boolean
  workspacesPlaceholder: boolean
}

export function resolveDataRetentionState(
  readiness: DataRetentionQueryReadiness
): DataRetentionState {
  if (readiness.retentionError || readiness.workspacesError) return 'error'
  if (
    !readiness.retentionSuccess ||
    readiness.retentionPlaceholder ||
    !readiness.workspacesSuccess ||
    readiness.workspacesPlaceholder
  ) {
    return 'loading'
  }
  return 'ready'
}

interface RetentionUpdateValues {
  logRetentionHours: number | null
  softDeleteRetentionHours: number | null
  taskCleanupHours: number | null
  retentionOverrides: RetentionOverride[]
  piiRedaction: PiiRedactionSettings
}

export function buildDataRetentionUpdateSettings(
  values: RetentionUpdateValues,
  piiEnabled: boolean
): UpdateOrganizationDataRetentionBody {
  const settings: UpdateOrganizationDataRetentionBody = {
    logRetentionHours: values.logRetentionHours,
    softDeleteRetentionHours: values.softDeleteRetentionHours,
    taskCleanupHours: values.taskCleanupHours,
    retentionOverrides: values.retentionOverrides,
  }
  if (piiEnabled) settings.piiRedaction = values.piiRedaction
  return settings
}
