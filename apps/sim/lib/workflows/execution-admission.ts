import {
  reserveExecutionSlot,
  UsageReservationUnavailableError,
} from '@/lib/billing/calculations/usage-reservation'
import {
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
  resolveBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import {
  getReservationDenialDescriptor,
  type ReservationDenialReason,
} from '@/lib/core/admission/transient-failure'
import { isBillingEnabled, isHosted } from '@/lib/core/config/env-flags'

export interface WorkflowExecutionActorContext {
  userId: string
  billingAttribution?: BillingAttributionSnapshot
}

export async function resolveWorkflowExecutionBillingAttribution(
  context: WorkflowExecutionActorContext,
  targetWorkspaceId: string
): Promise<BillingAttributionSnapshot | undefined> {
  const rootAttribution = context.billingAttribution
  if (!rootAttribution) return undefined
  if (rootAttribution.workspaceId === targetWorkspaceId) return rootAttribution

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

export async function prepareWorkflowExecutionAdmission(
  context: WorkflowExecutionActorContext,
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
    enterpriseConcurrencyLimit: billingAttribution.payerSubscription?.enterpriseConcurrencyLimit,
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
