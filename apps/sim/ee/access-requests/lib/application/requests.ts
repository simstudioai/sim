import { AuditAction, AuditResourceType } from '@sim/audit'
import {
  organizationAccessRequestSettings,
  permissionAccessRequest,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, count, eq, gte, isNull, or } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import type { AccessRequestContext } from '@/ee/access-requests/lib/application/authorization'
import { loadAccessRequestMembership } from '@/ee/access-requests/lib/application/authorization'
import { defineAuthorizedAccessRequestUseCase } from '@/ee/access-requests/lib/application/authorized-use-case'
import { accessRequestOperations } from '@/ee/access-requests/lib/application/operations'
import { prepareAccessRequestPolicy } from '@/ee/access-requests/lib/application/prepare'
import {
  listAccessRequestTargets,
  loadAccessRequestCatalog,
} from '@/ee/access-requests/lib/catalog'
import {
  ACCESS_REQUEST_MAX_DAILY_SUBMISSIONS,
  ACCESS_REQUEST_MAX_PENDING,
  ACCESS_REQUEST_SUBMISSION_WINDOW_MS,
} from '@/ee/access-requests/lib/constants'
import {
  PERMISSION_ACCESS_REQUEST_CREATED_EVENT,
  PERMISSION_ACCESS_REQUEST_DECIDED_EVENT,
} from '@/ee/access-requests/lib/notification-events'
import {
  evaluateAccessRequestTarget,
  loadAccessRequestPolicy,
} from '@/ee/access-requests/lib/policy'
import {
  listAccessRequestRecords,
  loadStoredAccessRequest,
  presentAccessRequest,
} from '@/ee/access-requests/lib/repository'
import {
  isAccessRequestEnabled,
  readAccessRequestSettings,
} from '@/ee/access-requests/lib/settings'
import type { AccessRequestScope } from '@/ee/access-requests/lib/targets'
import {
  describeAccessRequestTarget,
  getAccessRequestTargetKey,
  validateAccessRequestTarget,
} from '@/ee/access-requests/lib/targets'
import type {
  AccessRequestDiscovery,
  AccessRequestRecord,
  AccessRequestSettings,
  AccessRequestStatus,
  CreateAccessRequestInput,
  DiscoverAccessRequestsInput,
} from '@/ee/access-requests/lib/types'

function requireOrganization(organizationId: string | null): string {
  if (!organizationId)
    throw new OrchestrationError(
      'forbidden',
      'Access requests require an organization-owned workspace'
    )
  return organizationId
}

export function accessRequestScopeKey(scope: AccessRequestScope): string {
  return scope.kind === 'workspace'
    ? `workspace:${scope.workspaceId}`
    : `organization:${scope.organizationId}`
}

function memberLimitScopeKey(organizationId: string): string {
  return `organization:${organizationId}:member-limit`
}

async function hasCurrentMemberLimitMembership(
  executor: DbOrTx,
  context: AccessRequestContext,
  userId: string,
  pending: { workspaceId: string | null; membershipId: string }
): Promise<boolean> {
  if (!context.organizationId) return false
  if (pending.workspaceId && pending.workspaceId === context.workspaceId)
    return pending.membershipId === context.membershipId
  if (pending.workspaceId) {
    const [origin] = await executor
      .select({ id: workspace.id })
      .from(workspace)
      .where(
        and(
          eq(workspace.id, pending.workspaceId),
          eq(workspace.organizationId, context.organizationId),
          isNull(workspace.archivedAt)
        )
      )
      .limit(1)
    if (!origin) return false
  }
  const membership = await loadAccessRequestMembership(
    executor,
    userId,
    pending.workspaceId
      ? { kind: 'workspace', workspaceId: pending.workspaceId }
      : { kind: 'organization', organizationId: context.organizationId },
    context.organizationId
  )
  return membership?.membershipId === pending.membershipId
}

export const discoverAccessRequests = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.discover,
  scope: (input: DiscoverAccessRequestsInput) => input,
  async execute({ input, principal, context, executor }): Promise<AccessRequestDiscovery> {
    const organizationId = context.organizationId
    if (!organizationId || !(await isAccessRequestEnabled(organizationId, executor)))
      return { enabled: false, organizationId, entries: [], total: 0, hasMore: false }
    const catalog = await loadAccessRequestCatalog(
      {
        userId: principal.userId,
        organizationId,
        workspaceId: context.workspaceId,
      },
      input.targetKind
    )
    const search = input.search?.toLowerCase() ?? ''
    const targets = listAccessRequestTargets(catalog).filter((target) => {
      const description = describeAccessRequestTarget(target, catalog)
      return (
        description &&
        (description.scope === 'workspace-or-organization' || description.scope === input.kind) &&
        (!input.targetKind || input.targetKind === target.kind) &&
        (!input.targetKey || input.targetKey === getAccessRequestTargetKey(target)) &&
        (!search || description.label.toLowerCase().includes(search))
      )
    })
    const offset = input.offset ?? 0
    const policy = await loadAccessRequestPolicy(executor, context, principal.userId)
    const pending = await executor
      .select({
        id: permissionAccessRequest.id,
        targetKey: permissionAccessRequest.targetKey,
        membershipId: permissionAccessRequest.membershipId,
        groupId: permissionAccessRequest.groupId,
        workspaceId: permissionAccessRequest.workspaceId,
      })
      .from(permissionAccessRequest)
      .where(
        and(
          eq(permissionAccessRequest.organizationId, organizationId),
          eq(permissionAccessRequest.requesterId, principal.userId),
          or(
            eq(permissionAccessRequest.scopeKey, accessRequestScopeKey(input)),
            eq(permissionAccessRequest.scopeKey, memberLimitScopeKey(organizationId))
          ),
          eq(permissionAccessRequest.status, 'pending'),
          input.targetKey ? eq(permissionAccessRequest.targetKey, input.targetKey) : undefined
        )
      )
      .limit(ACCESS_REQUEST_MAX_PENDING)
    const pendingMemberLimit = pending.find((row) => row.targetKey === 'usage_limit:member')
    const memberLimitMembershipMatches = pendingMemberLimit
      ? await hasCurrentMemberLimitMembership(
          executor,
          context,
          principal.userId,
          pendingMemberLimit
        )
      : false
    const pendingByTarget = new Map(
      pending
        .filter((row) =>
          row.targetKey === 'usage_limit:member'
            ? memberLimitMembershipMatches
            : row.membershipId === context.membershipId &&
              row.groupId === (policy.group?.permissionGroupId ?? null)
        )
        .map((row) => [row.targetKey, row.id])
    )
    const entries: AccessRequestDiscovery['entries'] = []
    for (const target of targets) {
      const result = await evaluateAccessRequestTarget(
        executor,
        context,
        principal.userId,
        input,
        target,
        catalog,
        policy,
        false
      )
      if (input.state && result.state !== input.state) continue
      entries.push({
        target,
        label: describeAccessRequestTarget(target, catalog)!.label,
        state: result.state,
        reason: result.reason,
        pendingRequestId: pendingByTarget.get(getAccessRequestTargetKey(target)) ?? null,
      })
    }
    const page = entries.slice(offset, offset + (input.limit ?? 50))
    return {
      enabled: true,
      organizationId,
      entries: page,
      total: entries.length,
      hasMore: offset + page.length < entries.length,
    }
  },
})

interface MutationResult {
  request: AccessRequestRecord
  changed: boolean
}

export const createAccessRequest = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.create,
  scope: (input: CreateAccessRequestInput) => input.scope,
  prepare: ({ principal, context, input }) =>
    prepareAccessRequestPolicy(context, principal.userId, input.target.kind),
  mutation: true,
  async execute({
    principal,
    input,
    context,
    executor,
    prepared,
  }): Promise<MutationResult & { closedRequest?: AccessRequestRecord }> {
    const organizationId = requireOrganization(context.organizationId)
    if (!(await isAccessRequestEnabled(organizationId, executor)))
      throw new OrchestrationError(
        'forbidden',
        'Access requests are turned off for this organization'
      )
    await acquirePermissionGroupOrgLock(executor, organizationId, {
      lockTimeoutAlreadyBounded: true,
    })
    const catalog = prepared.catalog
    const target = validateAccessRequestTarget(input.target, catalog)
    if (!target)
      throw new OrchestrationError('validation', 'This item is unavailable for access requests')
    const targetKey = getAccessRequestTargetKey(target)
    const memberLimitMembership =
      target.kind === 'usage_limit'
        ? await loadAccessRequestMembership(
            executor,
            principal.userId,
            { kind: 'organization', organizationId },
            organizationId
          )
        : null
    const requestMembershipId = memberLimitMembership?.membershipId ?? context.membershipId
    const requestWorkspaceId = memberLimitMembership ? null : context.workspaceId
    const scopeKey =
      target.kind === 'usage_limit'
        ? memberLimitScopeKey(organizationId)
        : accessRequestScopeKey(input.scope)
    const currentPolicy = await loadAccessRequestPolicy(
      executor,
      context,
      principal.userId,
      prepared.entitled
    )
    const policy = await evaluateAccessRequestTarget(
      executor,
      context,
      principal.userId,
      input.scope,
      target,
      catalog,
      currentPolicy
    )
    const [pending] = await executor
      .select()
      .from(permissionAccessRequest)
      .where(
        and(
          eq(permissionAccessRequest.organizationId, organizationId),
          eq(permissionAccessRequest.requesterId, principal.userId),
          eq(permissionAccessRequest.scopeKey, scopeKey),
          eq(permissionAccessRequest.targetKey, targetKey),
          eq(permissionAccessRequest.status, 'pending')
        )
      )
      .limit(1)
    let pendingMembershipMatches = pending?.membershipId === requestMembershipId
    if (
      pending &&
      target.kind === 'usage_limit' &&
      !memberLimitMembership &&
      pending.workspaceId &&
      pending.workspaceId !== requestWorkspaceId
    ) {
      const [origin] = await executor
        .select({ id: workspace.id })
        .from(workspace)
        .where(
          and(
            eq(workspace.id, pending.workspaceId),
            eq(workspace.organizationId, organizationId),
            isNull(workspace.archivedAt)
          )
        )
        .limit(1)
      const membership = origin
        ? await loadAccessRequestMembership(
            executor,
            principal.userId,
            { kind: 'workspace', workspaceId: pending.workspaceId },
            organizationId
          )
        : null
      pendingMembershipMatches = membership?.membershipId === pending.membershipId
    }
    if (
      pending &&
      pendingMembershipMatches &&
      pending.groupId === (policy.group?.permissionGroupId ?? null) &&
      policy.state === 'requestable'
    )
      return { request: await presentAccessRequest(executor, pending), changed: false }
    let closedRequest: AccessRequestRecord | undefined
    if (pending) {
      const [closed] = await executor
        .update(permissionAccessRequest)
        .set({
          status: 'closed',
          decisionReason:
            policy.state === 'allowed'
              ? 'Access is already available.'
              : 'Membership or the governing policy changed after this request was created.',
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(permissionAccessRequest.id, pending.id))
        .returning()
      await enqueueOutboxEvent(executor, PERMISSION_ACCESS_REQUEST_DECIDED_EVENT, {
        requestId: pending.id,
      })
      if (policy.state === 'allowed')
        return { request: await presentAccessRequest(executor, closed), changed: true }
      closedRequest = await presentAccessRequest(executor, closed)
    }
    if (policy.state !== 'requestable')
      throw new OrchestrationError(
        'conflict',
        policy.reason ?? 'You already have access to this item'
      )
    const [outstanding] = await executor
      .select({ total: count() })
      .from(permissionAccessRequest)
      .where(
        and(
          eq(permissionAccessRequest.organizationId, organizationId),
          eq(permissionAccessRequest.requesterId, principal.userId),
          eq(permissionAccessRequest.status, 'pending')
        )
      )
    if ((outstanding?.total ?? 0) >= ACCESS_REQUEST_MAX_PENDING)
      throw new OrchestrationError(
        'conflict',
        `You have ${ACCESS_REQUEST_MAX_PENDING} pending requests. Cancel an existing request before sending another.`
      )
    const [daily] = await executor
      .select({ total: count() })
      .from(permissionAccessRequest)
      .where(
        and(
          eq(permissionAccessRequest.organizationId, organizationId),
          eq(permissionAccessRequest.requesterId, principal.userId),
          gte(
            permissionAccessRequest.createdAt,
            new Date(Date.now() - ACCESS_REQUEST_SUBMISSION_WINDOW_MS)
          )
        )
      )
    if ((daily?.total ?? 0) >= ACCESS_REQUEST_MAX_DAILY_SUBMISSIONS)
      throw new OrchestrationError(
        'conflict',
        `You have sent ${ACCESS_REQUEST_MAX_DAILY_SUBMISSIONS} requests in the last 24 hours. Try again later.`
      )
    const [row] = await executor
      .insert(permissionAccessRequest)
      .values({
        id: generateId(),
        organizationId,
        requesterId: principal.userId,
        workspaceId: requestWorkspaceId,
        scopeKey,
        targetKey,
        target,
        targetLabel: describeAccessRequestTarget(target, catalog)!.label,
        membershipId: requestMembershipId,
        groupId: policy.group?.permissionGroupId ?? null,
        groupName: policy.group?.groupName ?? null,
        reason: input.reason ?? '',
      })
      .returning()
    await enqueueOutboxEvent(executor, PERMISSION_ACCESS_REQUEST_CREATED_EVENT, {
      requestId: row.id,
    })
    return { request: await presentAccessRequest(executor, row), changed: true, closedRequest }
  },
  projectAudit: ({ result }) =>
    result.changed
      ? [
          ...(result.closedRequest
            ? [
                {
                  action: AuditAction.PERMISSION_ACCESS_REQUEST_CLOSED,
                  resourceType: AuditResourceType.PERMISSION_ACCESS_REQUEST,
                  resourceId: result.closedRequest.id,
                  workspaceId: result.closedRequest.workspaceId,
                  metadata: { target: result.closedRequest.target },
                },
              ]
            : []),
          {
            action:
              result.request.status === 'closed'
                ? AuditAction.PERMISSION_ACCESS_REQUEST_CLOSED
                : AuditAction.PERMISSION_ACCESS_REQUEST_CREATED,
            resourceType: AuditResourceType.PERMISSION_ACCESS_REQUEST,
            resourceId: result.request.id,
            workspaceId: result.request.workspaceId,
            metadata: { target: result.request.target },
          },
        ]
      : [],
})

interface ListMineInput {
  requestId?: string
  scope: AccessRequestScope
  limit: number
  offset: number
}
export const listMyAccessRequests = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.listMine,
  scope: (input: ListMineInput) => input.scope,
  async execute({ principal, input, context, executor }) {
    if (!context.organizationId) return { requests: [], total: 0, hasMore: false }
    return listAccessRequestRecords(
      executor,
      and(
        eq(permissionAccessRequest.organizationId, context.organizationId),
        eq(permissionAccessRequest.requesterId, principal.userId),
        input.requestId ? eq(permissionAccessRequest.id, input.requestId) : undefined,
        or(
          eq(permissionAccessRequest.scopeKey, accessRequestScopeKey(input.scope)),
          eq(permissionAccessRequest.scopeKey, memberLimitScopeKey(context.organizationId))
        )
      )!,
      input.limit,
      input.offset
    )
  },
})

interface CancelInput {
  scope: AccessRequestScope
  requestId: string
}
export const cancelAccessRequest = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.cancel,
  scope: (input: CancelInput) => input.scope,
  mutation: true,
  async execute({ principal, input, context, executor }): Promise<MutationResult> {
    const row = await loadStoredAccessRequest(
      executor,
      requireOrganization(context.organizationId),
      input.requestId,
      true
    )
    if (
      row.requesterId !== principal.userId ||
      (row.scopeKey !== accessRequestScopeKey(input.scope) &&
        row.scopeKey !== memberLimitScopeKey(row.organizationId))
    )
      throw new OrchestrationError('not_found', 'Access request not found')
    if (row.status !== 'pending')
      return { request: await presentAccessRequest(executor, row), changed: false }
    const [updated] = await executor
      .update(permissionAccessRequest)
      .set({
        status: 'cancelled',
        decidedBy: principal.userId,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(permissionAccessRequest.id, row.id))
      .returning()
    await enqueueOutboxEvent(executor, PERMISSION_ACCESS_REQUEST_DECIDED_EVENT, {
      requestId: row.id,
    })
    return { request: await presentAccessRequest(executor, updated), changed: true }
  },
  projectAudit: ({ result }) =>
    result.changed
      ? [
          {
            action: AuditAction.PERMISSION_ACCESS_REQUEST_CANCELLED,
            resourceType: AuditResourceType.PERMISSION_ACCESS_REQUEST,
            resourceId: result.request.id,
            workspaceId: result.request.workspaceId,
          },
        ]
      : [],
})

interface OrganizationInput {
  organizationId: string
}
interface OrganizationListInput extends OrganizationInput {
  limit: number
  offset: number
  status?: AccessRequestStatus
  search?: string
}
const organizationScope = (input: OrganizationInput): AccessRequestScope => ({
  kind: 'organization',
  organizationId: input.organizationId,
})

export const listOrganizationAccessRequests = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.listOrganization,
  scope: (input: OrganizationListInput) => organizationScope(input),
  execute: ({ input, executor }) =>
    listAccessRequestRecords(
      executor,
      and(
        eq(permissionAccessRequest.organizationId, input.organizationId),
        input.status ? eq(permissionAccessRequest.status, input.status) : undefined
      )!,
      input.limit,
      input.offset,
      input.search
    ),
})

export const getAccessRequestSettings = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.getSettings,
  scope: organizationScope,
  execute: ({ input, executor }) => readAccessRequestSettings(input.organizationId, executor),
})

interface UpdateSettingsInput extends OrganizationInput, AccessRequestSettings {}
export const updateAccessRequestSettings = defineAuthorizedAccessRequestUseCase({
  operation: accessRequestOperations.updateSettings,
  scope: (input: UpdateSettingsInput) => organizationScope(input),
  mutation: true,
  async execute({ principal, input, executor }): Promise<AccessRequestSettings> {
    await executor
      .insert(organizationAccessRequestSettings)
      .values({
        organizationId: input.organizationId,
        allowRequests: input.allowRequests,
        updatedBy: principal.userId,
      })
      .onConflictDoUpdate({
        target: organizationAccessRequestSettings.organizationId,
        set: {
          allowRequests: input.allowRequests,
          updatedBy: principal.userId,
          updatedAt: new Date(),
        },
      })
    return { allowRequests: input.allowRequests }
  },
  projectAudit: ({ input }) => [
    {
      action: AuditAction.PERMISSION_ACCESS_REQUEST_SETTINGS_CHANGED,
      resourceType: AuditResourceType.PERMISSION_ACCESS_REQUEST,
      resourceId: input.organizationId,
      metadata: { allowRequests: input.allowRequests },
    },
  ],
})
