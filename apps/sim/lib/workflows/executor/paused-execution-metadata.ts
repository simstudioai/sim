import { isRecordLike } from '@sim/utils/object'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import {
  type AutomaticResumeWaitingMetadata,
  normalizeAutomaticResumeWaitingReason,
} from '@/lib/workflows/executor/resume-policy'

export interface PausedExecutionResumeMetadata {
  executorUserId: string
  workspaceId: string
  billingAttribution: BillingAttributionSnapshot
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function createPausedExecutionResumeMetadata(
  snapshotValue: unknown,
  executorUserId?: string
): PausedExecutionResumeMetadata {
  if (!isRecordLike(snapshotValue) || !isRecordLike(snapshotValue.metadata)) {
    throw new Error('Paused execution snapshot metadata is missing')
  }

  const snapshotMetadata = snapshotValue.metadata
  if (!isNonEmptyString(snapshotMetadata.workspaceId)) {
    throw new Error('Paused execution snapshot workspace ID is missing')
  }

  const billingAttribution = assertBillingAttributionSnapshot(snapshotMetadata.billingAttribution)
  if (billingAttribution.workspaceId !== snapshotMetadata.workspaceId) {
    throw new Error('Paused execution workspace does not match its billing attribution')
  }

  const resolvedExecutorUserId = isNonEmptyString(executorUserId)
    ? executorUserId
    : isNonEmptyString(snapshotMetadata.userId)
      ? snapshotMetadata.userId
      : billingAttribution.actorUserId

  return {
    executorUserId: resolvedExecutorUserId,
    workspaceId: snapshotMetadata.workspaceId,
    billingAttribution,
  }
}

export function parsePausedExecutionResumeMetadata(
  value: unknown
): PausedExecutionResumeMetadata | null {
  if (!isRecordLike(value) || !isNonEmptyString(value.executorUserId)) {
    return null
  }
  if (!isNonEmptyString(value.workspaceId)) {
    return null
  }

  try {
    const billingAttribution = assertBillingAttributionSnapshot(value.billingAttribution)
    if (billingAttribution.workspaceId !== value.workspaceId) {
      return null
    }
    return {
      executorUserId: value.executorUserId,
      workspaceId: value.workspaceId,
      billingAttribution,
    }
  } catch {
    return null
  }
}

export function getAutomaticResumeWaitingMetadata(
  value: unknown
): AutomaticResumeWaitingMetadata | null {
  if (!isRecordLike(value) || !isRecordLike(value.automaticResumeWaiting)) {
    return null
  }

  const waiting = value.automaticResumeWaiting
  if (
    !isNonEmptyString(waiting.contextId) ||
    !isNonEmptyString(waiting.reason) ||
    !isNonEmptyString(waiting.recordedAt)
  ) {
    return null
  }

  return {
    contextId: waiting.contextId,
    reason: normalizeAutomaticResumeWaitingReason(waiting.reason),
    recordedAt: waiting.recordedAt,
  }
}
