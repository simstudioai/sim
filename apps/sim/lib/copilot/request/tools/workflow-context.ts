import { isRecordLike } from '@sim/utils/object'
import {
  reserveExecutionSlot,
  UsageReservationUnavailableError,
} from '@/lib/billing/calculations/usage-reservation'
import {
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
  resolveBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import type { ExecutionContext } from '@/lib/copilot/request/types'
import {
  getReservationDenialDescriptor,
  type ReservationDenialReason,
} from '@/lib/core/admission/transient-failure'
import { isBillingEnabled, isHosted } from '@/lib/core/config/env-flags'

function getCreateWorkflowOutput(
  output: unknown
): { workflowId?: string; workspaceId?: string } | undefined {
  if (!isRecordLike(output)) {
    return undefined
  }

  const workflowId = typeof output.workflowId === 'string' ? output.workflowId : undefined
  const workspaceId = typeof output.workspaceId === 'string' ? output.workspaceId : undefined
  if (!workflowId && !workspaceId) {
    return undefined
  }

  return {
    ...(workflowId ? { workflowId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
  }
}

/**
 * Applies the workflow target returned by create_workflow while leaving the
 * root Copilot lifecycle attribution untouched.
 */
export function applyCreateWorkflowOutputToContext(
  output: unknown,
  context: ExecutionContext
): void {
  const createdWorkflow = getCreateWorkflowOutput(output)
  if (!createdWorkflow?.workflowId || context.workflowId) {
    return
  }

  context.workflowId = createdWorkflow.workflowId
  if (createdWorkflow.workspaceId) {
    context.workspaceId = createdWorkflow.workspaceId
  }
}

/**
 * Selects billing for one hosted workflow execution. Same-workspace work
 * keeps the root snapshot; cross-workspace work gets a fresh child snapshot
 * without mutating or implicitly replacing the root lifecycle attribution.
 */
export async function resolveWorkflowExecutionBillingAttribution(
  context: ExecutionContext,
  targetWorkspaceId: string
): Promise<BillingAttributionSnapshot | undefined> {
  const rootAttribution = context.billingAttribution
  if (!rootAttribution) {
    return undefined
  }

  if (rootAttribution.workspaceId === targetWorkspaceId) {
    return rootAttribution
  }

  const childAttribution = await resolveBillingAttribution({
    actorUserId: context.userId,
    workspaceId: targetWorkspaceId,
  })
  if (
    childAttribution.actorUserId !== context.userId ||
    childAttribution.workspaceId !== targetWorkspaceId
  ) {
    throw new Error('Resolved workflow billing attribution does not match its actor and workspace')
  }

  return childAttribution
}

export interface WorkflowExecutionAdmission {
  billingAttribution: BillingAttributionSnapshot | undefined
  targetReservation: boolean
}

type ReservationDenialDescriptor = ReturnType<typeof getReservationDenialDescriptor>

export class WorkflowExecutionAdmissionError extends Error {
  readonly code: ReservationDenialDescriptor['code']
  readonly statusCode: ReservationDenialDescriptor['statusCode']
  readonly retryable: ReservationDenialDescriptor['retryable']

  constructor(message: string, descriptor: ReservationDenialDescriptor) {
    super(message)
    this.name = 'WorkflowExecutionAdmissionError'
    this.code = descriptor.code
    this.statusCode = descriptor.statusCode
    this.retryable = descriptor.retryable
  }
}

const TARGET_RESERVATION_DENIAL_MESSAGE = {
  payer_concurrency: 'Target workspace execution concurrency is currently exhausted',
  payer_headroom: 'Target workspace payer usage headroom is currently exhausted',
  member_headroom: 'Target workspace member usage headroom is currently exhausted',
} as const satisfies Record<ReservationDenialReason, string>

/**
 * Admits one direct Copilot workflow execution. Same-workspace runs reuse the
 * root lifecycle admission without another usage read or reservation.
 * Cross-workspace runs use their separately frozen target snapshot and perform
 * exactly one attributed usage check followed by one atomic reservation.
 */
export async function prepareWorkflowExecutionAdmission(
  context: ExecutionContext,
  targetWorkspaceId: string,
  childExecutionId: string
): Promise<WorkflowExecutionAdmission> {
  const billingAttribution = await resolveWorkflowExecutionBillingAttribution(
    context,
    targetWorkspaceId
  )
  const rootAttribution = context.billingAttribution
  const isCrossWorkspace =
    rootAttribution !== undefined && rootAttribution.workspaceId !== targetWorkspaceId

  if (!billingAttribution || !isCrossWorkspace) {
    return { billingAttribution, targetReservation: false }
  }

  const usage = await checkAttributedUsageLimits(billingAttribution)
  if (usage.isExceeded) {
    const descriptor = getReservationDenialDescriptor(
      usage.scope === 'member' ? 'member_headroom' : 'payer_headroom'
    )
    throw new WorkflowExecutionAdmissionError(
      usage.message ?? 'Target workspace usage limit exceeded',
      descriptor
    )
  }
  if (isHosted && isBillingEnabled && !usage.payerUsage) {
    throw new UsageReservationUnavailableError(
      'Target workspace usage admission is temporarily unavailable. Please retry.'
    )
  }

  const payerUsage = usage.payerUsage ?? { currentUsage: 0, limit: 0 }
  const reservation = await reserveExecutionSlot({
    billingEntity: billingAttribution.billingEntity,
    executionId: childExecutionId,
    plan: billingAttribution.payerSubscription?.plan,
    currentUsage: payerUsage.currentUsage,
    limit: payerUsage.limit,
    ...(billingAttribution.organizationId &&
    usage.memberUsage?.limit !== null &&
    usage.memberUsage?.limit !== undefined
      ? {
          member: {
            organizationId: billingAttribution.organizationId,
            actorUserId: billingAttribution.actorUserId,
            currentUsage: usage.memberUsage.currentUsage,
            limit: usage.memberUsage.limit,
          },
        }
      : {}),
  })
  if (!reservation.reserved) {
    const descriptor = getReservationDenialDescriptor(reservation.reason)
    throw new WorkflowExecutionAdmissionError(
      TARGET_RESERVATION_DENIAL_MESSAGE[reservation.reason],
      descriptor
    )
  }

  return { billingAttribution, targetReservation: true }
}
