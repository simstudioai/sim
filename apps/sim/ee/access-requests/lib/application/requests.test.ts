import { db } from '@sim/db'
import {
  organizationMemberUsageLimit,
  permissionAccessRequest,
  permissionGroup,
} from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccessRequestRecord, AccessRequestTarget } from '@/lib/api/contracts/access-requests'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import type { StoredAccessRequest } from '@/ee/access-requests/lib/repository'
import { createAccessRequestCatalog } from '@/ee/access-requests/lib/targets'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  membership: vi.fn(),
  organizationLock: vi.fn(),
  groupLock: vi.fn(),
  audit: vi.fn(),
  outbox: vi.fn(),
  enabled: vi.fn(),
  enterprise: vi.fn(),
  catalog: vi.fn(),
  targets: vi.fn(),
  deploymentReason: vi.fn(),
  group: vi.fn(),
  present: vi.fn(),
  stored: vi.fn(),
  list: vi.fn(),
}))

vi.mock('@/ee/access-requests/lib/application/authorization', () => ({
  authorizeAccessRequestScope: mocks.authorize,
  loadAccessRequestMembership: mocks.membership,
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: mocks.organizationLock,
}))
vi.mock('@/lib/core/application/authorized-workspace-use-case', () => ({
  recordProjectedUseCaseAuditEntries: mocks.audit,
}))
vi.mock('@/lib/core/outbox/service', () => ({ enqueueOutboxEvent: mocks.outbox }))
vi.mock('@/lib/permission-groups/locks', () => ({ acquirePermissionGroupOrgLock: mocks.groupLock }))
vi.mock('@/ee/access-requests/lib/settings', () => ({
  isAccessRequestEnabled: mocks.enabled,
  readAccessRequestSettings: vi.fn(),
}))
vi.mock('@/lib/core/config/env-flags', () => ({ isHosted: true, isAccessControlEnabled: true }))
vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mocks.enterprise,
}))
vi.mock('@/ee/access-requests/lib/catalog', () => ({
  loadAccessRequestCatalog: mocks.catalog,
  listAccessRequestTargets: mocks.targets,
  getAccessRequestDeploymentUnavailableReason: mocks.deploymentReason,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  resolveWorkspaceGroup: mocks.group,
  resolveDefaultGroup: mocks.group,
}))
vi.mock('@/ee/access-requests/lib/repository', () => ({
  presentAccessRequest: mocks.present,
  loadStoredAccessRequest: mocks.stored,
  listAccessRequestRecords: mocks.list,
}))

import {
  cancelAccessRequest,
  createAccessRequest,
  discoverAccessRequests,
} from '@/ee/access-requests/lib/application/requests'
import { PERMISSION_ACCESS_REQUEST_CREATED_EVENT } from '@/ee/access-requests/lib/notification-events'

const principal = { kind: 'session', userId: 'requester', sessionId: 'session' } as const
const scope = { kind: 'workspace', workspaceId: 'workspace' } as const
const context = {
  organizationId: 'organization',
  workspaceId: 'workspace',
  membershipId: 'membership',
  role: 'write',
} as const
const target = { kind: 'feature', configKey: 'hideTablesTab' } as const
const catalog = createAccessRequestCatalog({
  integrations: [{ id: 'slack_v2', label: 'Slack' }],
  providers: [],
  models: [],
  tools: [],
  knowledgeConnectors: [],
})
const group = {
  permissionGroupId: 'group',
  groupName: 'Restricted group',
  resolution: 'explicit-member',
  config: { ...DEFAULT_PERMISSION_GROUP_CONFIG, hideTablesTab: true, hideFilesTab: true },
} as const

function stored(overrides: Partial<StoredAccessRequest> = {}): StoredAccessRequest {
  return {
    id: 'request',
    organizationId: 'organization',
    requesterId: 'requester',
    workspaceId: 'workspace',
    scopeKey: 'workspace:workspace',
    targetKey: 'feature:hideTablesTab',
    target,
    targetLabel: 'Tables',
    membershipId: 'membership',
    groupId: 'group',
    groupName: 'Restricted group',
    reason: 'I need tables',
    status: 'pending',
    decisionReason: null,
    decidedBy: null,
    decision: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    decidedAt: null,
    ...overrides,
  }
}

function record(row: StoredAccessRequest): AccessRequestRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    target: row.target as AccessRequestTarget,
    targetLabel: row.targetLabel,
    reason: row.reason,
    status: row.status,
    decisionReason: row.decisionReason,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    groupName: row.groupName,
    requester: { id: row.requesterId, name: 'Requester', email: 'requester@example.com' },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  resetDbChainMock()
  mocks.authorize.mockResolvedValue(context)
  mocks.membership.mockResolvedValue(null)
  mocks.enabled.mockResolvedValue(true)
  mocks.enterprise.mockResolvedValue(true)
  mocks.catalog.mockResolvedValue(catalog)
  mocks.deploymentReason.mockReturnValue(null)
  mocks.targets.mockReturnValue([target])
  mocks.group.mockResolvedValue(group)
  mocks.stored.mockResolvedValue(stored())
  mocks.present.mockImplementation((_executor, row: StoredAccessRequest) => record(row))
  mocks.list.mockResolvedValue({ requests: [record(stored())], total: 1, hasMore: false })
})

describe('create access requests', () => {
  it('rejects unknown or deployment-excluded catalog IDs without creating a request', async () => {
    for (const id of ['private-custom-block', 'environment-disabled-block']) {
      await expect(
        createAccessRequest.execute({
          principal,
          input: { scope, target: { kind: 'integration', id } },
        })
      ).rejects.toThrow('unavailable')
    }
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mocks.outbox).not.toHaveBeenCalled()
  })

  it('refuses a feature with a hard deployment blocker even when a group also denies it', async () => {
    mocks.deploymentReason.mockReturnValue('Disabled by this deployment.')
    await expect(
      createAccessRequest.execute({ principal, input: { scope, target } })
    ).rejects.toThrow('Disabled by this deployment')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mocks.outbox).not.toHaveBeenCalled()
  })

  it('creates the durable request and outbox in the transaction without granting access', async () => {
    queueTableRows(permissionAccessRequest, [])
    queueTableRows(permissionAccessRequest, [{ total: 0 }])
    dbChainMockFns.returning.mockResolvedValueOnce([stored()])
    const result = await createAccessRequest.execute({
      principal,
      input: { scope, target, reason: 'I need tables' },
    })
    expect(result.changed).toBe(true)
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterId: principal.userId,
        membershipId: 'membership',
        groupId: 'group',
        target,
      })
    )
    expect(mocks.outbox).toHaveBeenCalledWith(db, PERMISSION_ACCESS_REQUEST_CREATED_EVENT, {
      requestId: 'request',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalledWith(permissionGroup)
    expect(mocks.authorize).toHaveBeenCalledTimes(2)
  })

  it('rejects an action unavailable to the baseline workspace role', async () => {
    mocks.authorize.mockResolvedValue({ ...context, role: 'read' })
    await expect(
      createAccessRequest.execute({
        principal,
        input: { scope, target: { kind: 'feature', configKey: 'disableTableCreation' } },
      })
    ).rejects.toThrow('workspace role')
    expect(mocks.outbox).not.toHaveBeenCalled()
  })

  it('blocks new requests while the toggle is off', async () => {
    mocks.enabled.mockResolvedValue(false)
    await expect(
      createAccessRequest.execute({ principal, input: { scope, target } })
    ).rejects.toThrow('turned off')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mocks.outbox).not.toHaveBeenCalled()
  })

  it.each([
    { pending: 100, daily: 0, message: '100 pending requests' },
    { pending: 0, daily: 100, message: '100 requests in the last 24 hours' },
  ])('enforces bounded admissions ($message)', async ({ pending, daily, message }) => {
    queueTableRows(permissionAccessRequest, [])
    queueTableRows(permissionAccessRequest, [{ total: pending }])
    queueTableRows(permissionAccessRequest, [{ total: daily }])
    await expect(
      createAccessRequest.execute({ principal, input: { scope, target } })
    ).rejects.toThrow(message)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mocks.outbox).not.toHaveBeenCalled()
  })

  it('normalizes member cap requests to one organization-wide request across workspaces', async () => {
    const cap = stored({
      target: { kind: 'usage_limit', id: 'member' },
      targetKey: 'usage_limit:member',
      scopeKey: 'organization:organization:member-limit',
      workspaceId: null,
      membershipId: 'org-membership',
      groupId: null,
      groupName: null,
    })
    mocks.membership.mockResolvedValue({ membershipId: 'org-membership', role: 'read' })
    queueTableRows(organizationMemberUsageLimit, [{ usageLimit: '10', updatedAt: new Date() }])
    dbChainMockFns.returning.mockResolvedValueOnce([cap])
    const first = await createAccessRequest.execute({
      principal,
      input: { scope, target: { kind: 'usage_limit', id: 'member' } },
    })
    expect(first.changed).toBe(true)
    expect(mocks.audit.mock.calls[0][4]).toEqual([
      expect.objectContaining({ workspaceId: null, resourceId: cap.id }),
    ])
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: null,
        membershipId: 'org-membership',
        scopeKey: 'organization:organization:member-limit',
      })
    )
    mocks.authorize.mockResolvedValue({
      ...context,
      workspaceId: 'another-workspace',
      membershipId: 'another-grant',
    })
    queueTableRows(organizationMemberUsageLimit, [{ usageLimit: '10', updatedAt: new Date() }])
    queueTableRows(permissionAccessRequest, [cap])
    const second = await createAccessRequest.execute({
      principal,
      input: {
        scope: { kind: 'workspace', workspaceId: 'another-workspace' },
        target: { kind: 'usage_limit', id: 'member' },
      },
    })
    expect(second).toMatchObject({ changed: false, request: { id: cap.id } })
    expect(mocks.outbox).toHaveBeenCalledOnce()
    expect(dbChainMockFns.insert).toHaveBeenCalledOnce()
  })
})

describe('discovery and request history', () => {
  it('finds an exact target beyond the first catalog page', async () => {
    const integrations = Array.from({ length: 125 }, (_, index) => ({
      id: `integration-${index}`,
      label: `Integration ${index}`,
    }))
    mocks.catalog.mockResolvedValue(
      createAccessRequestCatalog({
        integrations,
        providers: [],
        models: [],
        tools: [],
        knowledgeConnectors: [],
      })
    )
    mocks.targets.mockReturnValue(integrations.map(({ id }) => ({ kind: 'integration', id })))
    mocks.group.mockResolvedValue({
      ...group,
      config: { ...group.config, allowedIntegrations: [] },
    })
    const selected = { kind: 'integration', id: 'integration-124' } as const
    queueTableRows(permissionAccessRequest, [
      stored({ target: selected, targetKey: 'integration:integration-124' }),
    ])
    const result = await discoverAccessRequests.execute({
      principal,
      input: {
        ...scope,
        targetKind: 'integration',
        targetKey: 'integration:integration-124',
        limit: 1,
        offset: 0,
      },
    })
    expect(result).toMatchObject({
      total: 1,
      hasMore: false,
      entries: [{ target: selected, state: 'requestable', pendingRequestId: 'request' }],
    })
  })
})

describe('cancel access requests', () => {
  it.each(['workspace', null])(
    'keeps cancellation in the stored request scope %s',
    async (workspaceId) => {
      const row = stored({
        workspaceId,
        ...(workspaceId === null
          ? {
              scopeKey: 'organization:organization:member-limit',
              target: { kind: 'usage_limit', id: 'member' },
            }
          : {}),
      })
      mocks.stored.mockResolvedValue(row)
      dbChainMockFns.returning.mockResolvedValueOnce([{ ...row, status: 'cancelled' }])
      await cancelAccessRequest.execute({ principal, input: { scope, requestId: row.id } })
      expect(mocks.audit.mock.calls[0][4]).toEqual([
        expect.objectContaining({ workspaceId, resourceId: row.id }),
      ])
    }
  )

  it('conceals requests belonging to another user or another workspace', async () => {
    for (const row of [
      stored({ requesterId: 'other-user' }),
      stored({ scopeKey: 'workspace:other-workspace' }),
    ]) {
      mocks.stored.mockResolvedValue(row)
      await expect(
        cancelAccessRequest.execute({ principal, input: { scope, requestId: row.id } })
      ).rejects.toThrow('not found')
    }
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.outbox).not.toHaveBeenCalled()
  })
})
