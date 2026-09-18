import { createHash } from 'node:crypto'
import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { permissionAccessRequest, permissionGroup, workspace } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { creditsToDollars } from '@/lib/billing/credits/conversion'
import { setOrgMemberUsageLimit } from '@/lib/billing/organizations/member-limits'
import type { WorkspaceUseCaseAuditEntry } from '@/lib/core/application/authorized-workspace-use-case'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import { loadAccessRequestMembership } from '@/ee/access-requests/lib/application/authorization'
import { defineAuthorizedAccessRequestUseCase } from '@/ee/access-requests/lib/application/authorized-use-case'
import { accessRequestOperations } from '@/ee/access-requests/lib/application/operations'
import {
  type PreparedAccessRequestPolicy,
  prepareAccessRequestPolicy,
} from '@/ee/access-requests/lib/application/prepare'
import { loadAccessRequestGroupImpact } from '@/ee/access-requests/lib/impact'
import { PERMISSION_ACCESS_REQUEST_DECIDED_EVENT } from '@/ee/access-requests/lib/notification-events'
import {
  evaluateAccessRequestTarget,
  loadAccessRequestPolicy,
  loadMemberLimit,
} from '@/ee/access-requests/lib/policy'
import {
  loadStoredAccessRequest,
  presentAccessRequest,
  type StoredAccessRequest,
} from '@/ee/access-requests/lib/repository'
import {
  storedAccessRequestDecisionSchema,
  storedAccessRequestTargetSchema,
} from '@/ee/access-requests/lib/schemas'
import { isAccessRequestEnabled } from '@/ee/access-requests/lib/settings'
import type { AccessRequestScope } from '@/ee/access-requests/lib/targets'
import type {
  AccessRequestPreview,
  ResolveAccessRequestDecision,
} from '@/ee/access-requests/lib/types'

interface ReviewInput {
  organizationId: string
  requestId: string
}
interface ResolveInput extends ReviewInput {
  decision: ResolveAccessRequestDecision
}
const organizationScope = (input: ReviewInput): AccessRequestScope => ({
  kind: 'organization',
  organizationId: input.organizationId,
})

/** Checks the requester's present scope before inspecting or modifying any governing policy. */
async function loadReviewPreview(
  executor: DbOrTx,
  row: StoredAccessRequest,
  prepared: PreparedAccessRequestPolicy | null,
  forUpdate = false
) {
  const request = await presentAccessRequest(executor, row)
  if (row.status === 'fulfilled' && row.decision) {
    const snapshot = storedAccessRequestDecisionSchema.parse(row.decision)
    const common = {
      request,
      changes: snapshot.changes,
      impact: snapshot.impact,
      fingerprint: snapshot.fingerprint,
      canApply: false,
      unavailableReason: 'This request has already been fulfilled.',
      newLimitCredits: snapshot.newLimitCredits,
    }
    const preview: AccessRequestPreview =
      snapshot.resolutionKind === 'usage_limit'
        ? {
            ...common,
            resolutionKind: 'usage_limit',
            group: null,
            currentLimitCredits: snapshot.currentLimitCredits,
          }
        : {
            ...common,
            resolutionKind: 'permission',
            group: snapshot.group,
            currentLimitCredits: null,
          }
    return { preview, policy: null }
  }
  if (!prepared) throw new OrchestrationError('internal', 'Request preview preparation is missing')
  const scope: AccessRequestScope = row.workspaceId
    ? { kind: 'workspace', workspaceId: row.workspaceId }
    : { kind: 'organization', organizationId: row.organizationId }
  let canonicalWorkspaceValid = true
  if (row.workspaceId) {
    const query = executor
      .select({
        organizationId: workspace.organizationId,
        allowPersonalApiKeys: workspace.allowPersonalApiKeys,
      })
      .from(workspace)
      .where(and(eq(workspace.id, row.workspaceId), isNull(workspace.archivedAt)))
    const [canonical] = forUpdate ? await query.for('update').limit(1) : await query.limit(1)
    canonicalWorkspaceValid = Boolean(canonical && canonical.organizationId === row.organizationId)
  }
  const membership = canonicalWorkspaceValid
    ? await loadAccessRequestMembership(
        executor,
        row.requesterId,
        scope,
        row.organizationId,
        forUpdate
      )
    : null
  const context = {
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    membershipId: membership?.membershipId ?? '',
    role: membership?.role ?? ('read' as const),
  }
  if (forUpdate)
    await acquirePermissionGroupOrgLock(executor, row.organizationId, {
      lockTimeoutAlreadyBounded: true,
    })
  const catalog = prepared.catalog
  const currentPolicy = await loadAccessRequestPolicy(
    executor,
    context,
    row.requesterId,
    prepared.entitled
  )
  const target = storedAccessRequestTargetSchema.parse(row.target)
  const policy = await evaluateAccessRequestTarget(
    executor,
    context,
    row.requesterId,
    scope,
    target,
    catalog,
    currentPolicy
  )
  const enabled = await isAccessRequestEnabled(row.organizationId, executor)
  const audience = policy.group
    ? await loadAccessRequestGroupImpact(
        executor,
        row.organizationId,
        policy.group.permissionGroupId
      )
    : {
        impact: {
          memberCount: 1,
          workspaceCount: row.workspaceId ? 1 : 0,
          workspaceNames: [],
          truncated: false,
        },
        revision: '',
      }
  const limit =
    target.kind === 'usage_limit'
      ? await loadMemberLimit(executor, row.organizationId, row.requesterId, forUpdate)
      : null
  const unavailableReason =
    row.status !== 'pending'
      ? 'This request has already been resolved.'
      : !enabled
        ? 'Access requests are turned off for this organization.'
        : !membership || membership.membershipId !== row.membershipId
          ? 'The requester’s membership changed. Ask them to send a new request.'
          : policy.state === 'unavailable'
            ? policy.reason
            : target.kind !== 'usage_limit' && policy.group?.permissionGroupId !== row.groupId
              ? 'The governing permission group changed. Ask the requester to send a new request.'
              : target.kind === 'usage_limit' && !limit
                ? 'The requester no longer has a member credit cap.'
                : null
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        requestId: row.id,
        status: row.status,
        target,
        membership: membership?.membershipId,
        role: membership?.role,
        groupId: policy.group?.permissionGroupId,
        config: policy.group?.config,
        changes: policy.delta?.changes,
        audience: audience.revision,
        limit,
        enabled,
        unavailableReason,
      })
    )
    .digest('hex')
  const common = {
    newLimitCredits: null,
    request,
    changes: policy.delta?.changes ?? [],
    impact: audience.impact,
    fingerprint,
    canApply: !unavailableReason,
    unavailableReason,
  }
  const preview: AccessRequestPreview =
    target.kind === 'usage_limit'
      ? {
          ...common,
          resolutionKind: 'usage_limit',
          group: null,
          currentLimitCredits: limit?.credits ?? null,
        }
      : {
          ...common,
          resolutionKind: 'permission',
          group: policy.group
            ? { id: policy.group.permissionGroupId, name: policy.group.groupName }
            : null,
          currentLimitCredits: null,
        }
  return { preview, policy }
}

export const previewAccessRequest = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.preview,
  scope: organizationScope,
  prepare: async ({ input }) => {
    const row = await loadStoredAccessRequest(db, input.organizationId, input.requestId)
    if (row.status === 'fulfilled' && row.decision) return null
    return prepareAccessRequestPolicy(
      row,
      row.requesterId,
      storedAccessRequestTargetSchema.parse(row.target).kind
    )
  },
  async execute({ input, executor, prepared }) {
    const row = await loadStoredAccessRequest(executor, input.organizationId, input.requestId)
    return (await loadReviewPreview(executor, row, prepared)).preview
  },
})

export const resolveAccessRequest = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.resolve,
  scope: (input: ResolveInput) => organizationScope(input),
  mutation: true,
  prepare: async ({ input }) => {
    if (input.decision.action === 'decline') return null
    const row = await loadStoredAccessRequest(db, input.organizationId, input.requestId)
    if (row.status !== 'pending') return null
    return prepareAccessRequestPolicy(
      row,
      row.requesterId,
      storedAccessRequestTargetSchema.parse(row.target).kind
    )
  },
  async execute({ principal, input, executor, prepared }) {
    const row = await loadStoredAccessRequest(executor, input.organizationId, input.requestId, true)
    if (row.status !== 'pending')
      return { request: await presentAccessRequest(executor, row), changed: false }
    const now = new Date()
    if (input.decision.action === 'decline') {
      const [updated] = await executor
        .update(permissionAccessRequest)
        .set({
          status: 'declined',
          decisionReason: input.decision.reason,
          decidedBy: principal.userId,
          decidedAt: now,
          updatedAt: now,
        })
        .where(eq(permissionAccessRequest.id, row.id))
        .returning()
      await enqueueOutboxEvent(executor, PERMISSION_ACCESS_REQUEST_DECIDED_EVENT, {
        requestId: row.id,
      })
      return { request: await presentAccessRequest(executor, updated), changed: true }
    }
    if (!prepared)
      throw new OrchestrationError('internal', 'Request preview preparation is missing')
    const { preview, policy } = await loadReviewPreview(executor, row, prepared, true)
    if (!preview.canApply)
      throw new OrchestrationError(
        'conflict',
        preview.unavailableReason ?? 'This request can no longer be fulfilled'
      )
    if (preview.fingerprint !== input.decision.expectedFingerprint)
      throw new OrchestrationError(
        'conflict',
        'The policy or affected scope changed. Review the updated preview before applying.'
      )
    if (!policy) throw new OrchestrationError('conflict', 'This request has already been fulfilled')
    const newLimitCredits = input.decision.newLimitCredits
    if (preview.resolutionKind === 'usage_limit') {
      if (
        newLimitCredits === undefined ||
        !Number.isSafeInteger(newLimitCredits) ||
        newLimitCredits <= (preview.currentLimitCredits ?? 0)
      )
        throw new OrchestrationError(
          'validation',
          'Enter a whole-number credit limit greater than the current limit'
        )
      await setOrgMemberUsageLimit(
        row.organizationId,
        row.requesterId,
        creditsToDollars(newLimitCredits),
        principal.userId,
        executor
      )
    } else {
      if (newLimitCredits !== undefined)
        throw new OrchestrationError(
          'validation',
          'A credit limit cannot be applied to a permission request'
        )
      if (!policy.group || !policy.delta)
        throw new OrchestrationError(
          'conflict',
          'The governing permission group is no longer available'
        )
      if (policy.delta.changes.length)
        await executor
          .update(permissionGroup)
          .set({ config: policy.delta.config, updatedAt: now })
          .where(
            and(
              eq(permissionGroup.id, policy.group.permissionGroupId),
              eq(permissionGroup.organizationId, row.organizationId)
            )
          )
    }
    const decision = storedAccessRequestDecisionSchema.parse({
      resolutionKind: preview.resolutionKind,
      changes: preview.changes,
      impact: preview.impact,
      group: preview.group,
      currentLimitCredits: preview.currentLimitCredits,
      newLimitCredits: newLimitCredits ?? null,
      fingerprint: preview.fingerprint,
    })
    const [updated] = await executor
      .update(permissionAccessRequest)
      .set({
        status: 'fulfilled',
        decidedBy: principal.userId,
        decidedAt: now,
        updatedAt: now,
        decision,
      })
      .where(eq(permissionAccessRequest.id, row.id))
      .returning()
    await enqueueOutboxEvent(executor, PERMISSION_ACCESS_REQUEST_DECIDED_EVENT, {
      requestId: row.id,
    })
    return { request: await presentAccessRequest(executor, updated), changed: true, decision }
  },
  projectAudit: ({ result }) => {
    if (!result.changed) return []
    const decision = 'decision' in result ? result.decision : undefined
    const entries: WorkspaceUseCaseAuditEntry[] = [
      {
        action:
          result.request.status === 'fulfilled'
            ? AuditAction.PERMISSION_ACCESS_REQUEST_FULFILLED
            : AuditAction.PERMISSION_ACCESS_REQUEST_DECLINED,
        resourceType: AuditResourceType.PERMISSION_ACCESS_REQUEST,
        resourceId: result.request.id,
        workspaceId: result.request.workspaceId,
        metadata: {
          target: result.request.target,
          requesterId: result.request.requester.id,
          ...(decision ? { decision } : {}),
        },
      },
    ]
    if (decision?.resolutionKind === 'permission' && decision.group && decision.changes.length) {
      entries.push({
        action: AuditAction.PERMISSION_GROUP_UPDATED,
        resourceType: AuditResourceType.PERMISSION_GROUP,
        resourceId: decision.group.id,
        resourceName: decision.group.name,
        metadata: { requestId: result.request.id, changes: decision.changes },
      })
    }
    if (decision?.resolutionKind === 'usage_limit') {
      entries.push({
        action: AuditAction.ORG_MEMBER_USAGE_LIMIT_CHANGED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: result.request.organizationId,
        metadata: {
          requestId: result.request.id,
          userId: result.request.requester.id,
          creditLimit: decision.newLimitCredits,
          previousCreditLimit: decision.currentLimitCredits,
        },
      })
    }
    return entries
  },
})
