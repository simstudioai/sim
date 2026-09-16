/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import {
  organizationMemberUsageLimit,
  permissionAccessRequest,
  permissionGroup,
  workspace,
} from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccessRequestRecord, AccessRequestTarget } from '@/lib/api/contracts/access-requests'
import type { StoredAccessRequest } from '@/lib/permission-access-requests/repository'
import { createAccessRequestCatalog } from '@/lib/permission-groups/access-requests/targets'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  membership: vi.fn(),
  organizationLock: vi.fn(),
  groupLock: vi.fn(),
  audit: vi.fn(),
  outbox: vi.fn(),
  enabled: vi.fn(),
  featureEnabled: vi.fn(),
  enterprise: vi.fn(),
  catalog: vi.fn(),
  targets: vi.fn(),
  deploymentReason: vi.fn(),
  group: vi.fn(),
  present: vi.fn(),
  stored: vi.fn(),
  list: vi.fn(),
}))

vi.mock('@/lib/permission-access-requests/application/authorization', () => ({
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
vi.mock('@/lib/permission-access-requests/settings', () => ({
  isAccessRequestEnabled: mocks.enabled,
  readAccessRequestSettings: vi.fn(),
}))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: mocks.featureEnabled }))
vi.mock('@/lib/core/config/env-flags', () => ({ isHosted: true, isAccessControlEnabled: true }))
vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mocks.enterprise,
}))
vi.mock('@/lib/permission-access-requests/catalog', () => ({
  loadAccessRequestCatalog: mocks.catalog,
  listAccessRequestTargets: mocks.targets,
  getAccessRequestDeploymentUnavailableReason: mocks.deploymentReason,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  resolveWorkspaceGroup: mocks.group,
  resolveDefaultGroup: mocks.group,
}))
vi.mock('@/lib/permission-access-requests/repository', () => ({
  presentAccessRequest: mocks.present,
  loadStoredAccessRequest: mocks.stored,
  listAccessRequestRecords: mocks.list,
}))

import {
  cancelAccessRequest,
  createAccessRequest,
  discoverAccessRequests,
  listMyAccessRequests,
} from '@/lib/permission-access-requests/application/requests'
import {
  PERMISSION_ACCESS_REQUEST_CREATED_EVENT,
  PERMISSION_ACCESS_REQUEST_DECIDED_EVENT,
} from '@/lib/permission-access-requests/notification-events'

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
  mocks.featureEnabled.mockResolvedValue(true)
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

  it('returns an existing pending request without another notification or policy mutation', async () => {
    queueTableRows(permissionAccessRequest, [stored()])
    const result = await createAccessRequest.execute({ principal, input: { scope, target } })
    expect(result).toMatchObject({ changed: false, request: { id: 'request', status: 'pending' } })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
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

  it('closes an obsolete pending request before recording its replacement', async () => {
    queueTableRows(permissionAccessRequest, [stored({ groupId: 'previous-group' })])
    dbChainMockFns.returning
      .mockResolvedValueOnce([stored({ status: 'closed' })])
      .mockResolvedValueOnce([stored({ id: 'replacement' })])
    const result = await createAccessRequest.execute({ principal, input: { scope, target } })
    expect(result.request.id).toBe('replacement')
    expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'closed' }))
    expect(mocks.outbox.mock.calls.map(([, event, payload]) => [event, payload])).toEqual([
      [PERMISSION_ACCESS_REQUEST_DECIDED_EVENT, { requestId: 'request' }],
      [PERMISSION_ACCESS_REQUEST_CREATED_EVENT, { requestId: 'replacement' }],
    ])
  })

  it('closes an existing pending request if access is already available', async () => {
    mocks.group.mockResolvedValue({ ...group, config: DEFAULT_PERMISSION_GROUP_CONFIG })
    queueTableRows(permissionAccessRequest, [stored()])
    dbChainMockFns.returning.mockResolvedValueOnce([
      stored({ status: 'closed', decisionReason: 'Access is already available.' }),
    ])
    const result = await createAccessRequest.execute({ principal, input: { scope, target } })
    expect(result.request).toMatchObject({
      status: 'closed',
      decisionReason: 'Access is already available.',
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(mocks.outbox).toHaveBeenCalledWith(db, PERMISSION_ACCESS_REQUEST_DECIDED_EVENT, {
      requestId: 'request',
    })
  })

  it.each([
    { pending: 100, daily: 0, message: '100 pending requests' },
    { pending: 0, daily: 25, message: 'maximum of 25 requests today' },
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

  it('preserves workspace membership provenance for an external member cap request', async () => {
    queueTableRows(organizationMemberUsageLimit, [{ usageLimit: '10', updatedAt: new Date() }])
    dbChainMockFns.returning.mockResolvedValueOnce([
      stored({ target: { kind: 'usage_limit', id: 'member' }, groupId: null }),
    ])
    await createAccessRequest.execute({
      principal,
      input: { scope, target: { kind: 'usage_limit', id: 'member' } },
    })
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace',
        membershipId: 'membership',
        scopeKey: 'organization:organization:member-limit',
      })
    )
  })

  it.each([true, false])(
    'deduplicates an external member cap only while its original access remains valid (%s)',
    async (originValid) => {
      const cap = stored({
        target: { kind: 'usage_limit', id: 'member' },
        targetKey: 'usage_limit:member',
        scopeKey: 'organization:organization:member-limit',
        workspaceId: 'original-workspace',
        membershipId: 'original-grant',
        groupId: null,
        groupName: null,
      })
      mocks.membership
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ membershipId: 'original-grant', role: 'read' })
      queueTableRows(organizationMemberUsageLimit, [{ usageLimit: '10', updatedAt: new Date() }])
      queueTableRows(permissionAccessRequest, [cap])
      queueTableRows(workspace, originValid ? [{ id: 'original-workspace' }] : [])
      if (!originValid) {
        dbChainMockFns.returning.mockResolvedValueOnce([stored({ ...cap, status: 'closed' })])
        dbChainMockFns.returning.mockResolvedValueOnce([stored({ ...cap, id: 'replacement' })])
      }
      const result = await createAccessRequest.execute({
        principal,
        input: { scope, target: { kind: 'usage_limit', id: 'member' } },
      })
      expect(result.changed).toBe(!originValid)
      if (originValid) {
        expect(result.request.id).toBe(cap.id)
        expect(dbChainMockFns.insert).not.toHaveBeenCalled()
        expect(mocks.outbox).not.toHaveBeenCalled()
      } else {
        expect(result.request.id).toBe('replacement')
        expect(mocks.outbox).toHaveBeenCalledTimes(2)
      }
    }
  )
})

describe('discovery and request history', () => {
  it('filters requestable state before pagination and reports pending request IDs', async () => {
    mocks.targets.mockReturnValue([
      { kind: 'feature', configKey: 'hideKnowledgeBaseTab' },
      target,
      { kind: 'feature', configKey: 'hideFilesTab' },
    ])
    queueTableRows(permissionAccessRequest, [
      {
        id: 'existing-file-request',
        targetKey: 'feature:hideFilesTab',
        membershipId: 'membership',
        groupId: 'group',
      },
    ])
    const result = await discoverAccessRequests.execute({
      principal,
      input: { ...scope, state: 'requestable', limit: 1, offset: 1 },
    })
    expect(result).toMatchObject({
      total: 2,
      hasMore: false,
      entries: [
        {
          target: { kind: 'feature', configKey: 'hideFilesTab' },
          pendingRequestId: 'existing-file-request',
        },
      ],
    })
    expect(mocks.group).toHaveBeenCalledOnce()
  })

  it('allows a new request when a pending request belongs to a previous governing group', async () => {
    queueTableRows(permissionAccessRequest, [stored({ groupId: 'previous-group' })])
    const result = await discoverAccessRequests.execute({
      principal,
      input: { ...scope, state: 'requestable', limit: 50, offset: 0 },
    })
    expect(result.entries).toEqual([expect.objectContaining({ target, pendingRequestId: null })])
  })

  it('hides discovery while disabled but retains requester history', async () => {
    mocks.enabled.mockResolvedValue(false)
    const discovery = await discoverAccessRequests.execute({
      principal,
      input: { ...scope, limit: 50, offset: 0 },
    })
    expect(discovery).toMatchObject({ enabled: false, entries: [] })
    const history = await listMyAccessRequests.execute({
      principal,
      input: { scope, limit: 50, offset: 0 },
    })
    expect(history.requests).toHaveLength(1)
    expect(mocks.list).toHaveBeenCalledWith(db, expect.anything(), 50, 0)
    expect(mocks.list.mock.calls[0]?.[1]).toMatchObject({
      conditions: expect.arrayContaining([
        expect.objectContaining({
          type: 'or',
          conditions: expect.arrayContaining([
            expect.objectContaining({
              left: permissionAccessRequest.scopeKey,
              right: 'organization:organization:member-limit',
            }),
          ]),
        }),
      ]),
    })
  })
})

describe('cancel access requests', () => {
  it('allows cancellation while disabled and does not resend a decision for terminal requests', async () => {
    mocks.enabled.mockResolvedValue(false)
    dbChainMockFns.returning.mockResolvedValueOnce([stored({ status: 'cancelled' })])
    const first = await cancelAccessRequest.execute({
      principal,
      input: { scope, requestId: 'request' },
    })
    expect(first.request.status).toBe('cancelled')
    expect(mocks.outbox).toHaveBeenCalledWith(db, PERMISSION_ACCESS_REQUEST_DECIDED_EVENT, {
      requestId: 'request',
    })
    mocks.stored.mockResolvedValue(stored({ status: 'cancelled' }))
    const second = await cancelAccessRequest.execute({
      principal,
      input: { scope, requestId: 'request' },
    })
    expect(second.changed).toBe(false)
    expect(mocks.outbox).toHaveBeenCalledOnce()
  })

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
