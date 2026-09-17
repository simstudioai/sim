/**
 * @vitest-environment node
 */
import { AuditAction } from '@sim/audit'
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
  deploymentReason: vi.fn(),
  group: vi.fn(),
  impact: vi.fn(),
  present: vi.fn(),
  stored: vi.fn(),
  setLimit: vi.fn(),
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
}))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: mocks.featureEnabled }))
vi.mock('@/lib/core/config/env-flags', () => ({ isHosted: true, isAccessControlEnabled: true }))
vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: mocks.enterprise,
}))
vi.mock('@/lib/permission-access-requests/catalog', () => ({
  loadAccessRequestCatalog: mocks.catalog,
  getAccessRequestDeploymentUnavailableReason: mocks.deploymentReason,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  resolveWorkspaceGroup: mocks.group,
  resolveDefaultGroup: mocks.group,
}))
vi.mock('@/lib/permission-access-requests/impact', () => ({
  loadAccessRequestGroupImpact: mocks.impact,
}))
vi.mock('@/lib/permission-access-requests/repository', () => ({
  presentAccessRequest: mocks.present,
  loadStoredAccessRequest: mocks.stored,
}))
vi.mock('@/lib/billing/organizations/member-limits', () => ({
  setOrgMemberUsageLimit: mocks.setLimit,
}))

import {
  previewAccessRequest,
  resolveAccessRequest,
} from '@/lib/permission-access-requests/application/review'
import { PERMISSION_ACCESS_REQUEST_DECIDED_EVENT } from '@/lib/permission-access-requests/notification-events'

const principal = { kind: 'session', userId: 'admin', sessionId: 'session' } as const
const input = { organizationId: 'organization', requestId: 'request' }
const target = { kind: 'model', id: 'gpt-example' } as const
const catalog = createAccessRequestCatalog({
  integrations: [],
  providers: [{ id: 'openai', label: 'OpenAI' }],
  models: [{ id: 'gpt-example', label: 'Example model', providerId: 'openai' }],
  tools: [],
  knowledgeConnectors: [],
})
const group = {
  permissionGroupId: 'group',
  groupName: 'Restricted group',
  resolution: 'explicit-member',
  config: {
    ...DEFAULT_PERMISSION_GROUP_CONFIG,
    allowedModelProviders: [],
    deniedModels: ['gpt-example', 'keep-denied'],
    hideTablesTab: true,
  },
}
const impact = {
  memberCount: 12,
  workspaceCount: 2,
  workspaceNames: ['One', 'Two'],
  truncated: false,
}

function stored(overrides: Partial<StoredAccessRequest> = {}): StoredAccessRequest {
  return {
    id: 'request',
    organizationId: 'organization',
    requesterId: 'requester',
    workspaceId: 'workspace',
    scopeKey: 'workspace:workspace',
    targetKey: 'model:gpt-example',
    target,
    targetLabel: 'Example model',
    membershipId: 'membership',
    groupId: 'group',
    groupName: 'Restricted group',
    reason: '',
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

function queueWorkspace() {
  queueTableRows(workspace, [{ organizationId: 'organization', allowPersonalApiKeys: true }])
}

function queueLimit(credits: number) {
  const row = { usageLimit: String(credits / 200), updatedAt: new Date('2026-09-01T00:00:00Z') }
  queueTableRows(organizationMemberUsageLimit, [row])
  queueTableRows(organizationMemberUsageLimit, [row])
}

async function preview() {
  queueWorkspace()
  return previewAccessRequest.execute({ principal, input })
}

beforeEach(() => {
  vi.resetAllMocks()
  resetDbChainMock()
  mocks.authorize.mockResolvedValue({
    organizationId: 'organization',
    workspaceId: null,
    membershipId: 'admin-membership',
    role: 'admin',
  })
  mocks.membership.mockResolvedValue({ membershipId: 'membership', role: 'read' })
  mocks.enabled.mockResolvedValue(true)
  mocks.featureEnabled.mockResolvedValue(true)
  mocks.enterprise.mockResolvedValue(true)
  mocks.catalog.mockResolvedValue(catalog)
  mocks.deploymentReason.mockReturnValue(null)
  mocks.group.mockResolvedValue(group)
  mocks.impact.mockResolvedValue({ impact, revision: 'cohort-v1' })
  mocks.stored.mockResolvedValue(stored())
  mocks.present.mockImplementation((_executor, row: StoredAccessRequest) => record(row))
})

describe('permission request review', () => {
  it('shows the provider expansion, exact model removal, and affected scope together', async () => {
    const result = await preview()
    expect(result).toMatchObject({
      canApply: true,
      resolutionKind: 'permission',
      group: { id: 'group' },
      impact,
    })
    expect(result.changes).toEqual([
      expect.objectContaining({
        configKey: 'allowedModelProviders',
        before: [],
        after: ['openai'],
      }),
      expect.objectContaining({
        configKey: 'deniedModels',
        before: ['gpt-example', 'keep-denied'],
        after: ['keep-denied'],
      }),
    ])
  })

  it('rechecks enterprise entitlement after admission on the transaction executor', async () => {
    const before = await preview()
    mocks.enterprise.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    queueWorkspace()
    await expect(
      resolveAccessRequest.execute({
        principal,
        input: {
          ...input,
          decision: { action: 'apply', expectedFingerprint: before.fingerprint },
        },
      })
    ).rejects.toThrow('Permission groups are unavailable')
    expect(mocks.enterprise).toHaveBeenLastCalledWith('organization', 'return-false', db)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.outbox).not.toHaveBeenCalled()
  })

  it('preserves valid legacy policy values and long names in fulfilled snapshots', async () => {
    const longName = 'x'.repeat(600)
    mocks.group.mockResolvedValue({
      ...group,
      groupName: longName,
      config: {
        ...group.config,
        deniedModels: [
          target.id,
          ...Array.from({ length: 10_001 }, (_, index) => `${longName}${index}`),
        ],
      },
    })
    mocks.impact.mockResolvedValue({
      impact: { ...impact, workspaceNames: [longName] },
      revision: 'large-policy',
    })
    const before = await preview()
    queueWorkspace()
    dbChainMockFns.returning.mockResolvedValueOnce([stored({ status: 'fulfilled' })])
    const result = await resolveAccessRequest.execute({
      principal,
      input: {
        ...input,
        decision: { action: 'apply', expectedFingerprint: before.fingerprint },
      },
    })
    const decision = 'decision' in result ? result.decision : undefined
    expect(
      decision?.changes.find((change) => change.configKey === 'deniedModels')?.after
    ).toHaveLength(10_001)
    mocks.stored.mockResolvedValue(stored({ status: 'fulfilled', decision }))
    const history = await previewAccessRequest.execute({ principal, input })
    expect(history.impact.workspaceNames).toEqual([longName])
    expect(history.group?.name).toBe(longName)
  })

  it('rejects a stale preview when either policy or audience changes', async () => {
    const before = await preview()
    mocks.impact.mockResolvedValue({ impact, revision: 'cohort-v2' })
    queueWorkspace()
    await expect(
      resolveAccessRequest.execute({
        principal,
        input: { ...input, decision: { action: 'apply', expectedFingerprint: before.fingerprint } },
      })
    ).rejects.toThrow('Review the updated preview')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.outbox).not.toHaveBeenCalled()
  })

  it('refuses an approval after the requester moves into another governing group', async () => {
    const before = await preview()
    mocks.group.mockResolvedValue({ ...group, permissionGroupId: 'replacement-group' })
    queueWorkspace()
    await expect(
      resolveAccessRequest.execute({
        principal,
        input: { ...input, decision: { action: 'apply', expectedFingerprint: before.fingerprint } },
      })
    ).rejects.toThrow('governing permission group changed')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('requires a fresh preview when catalog parent rules change the proposed patch', async () => {
    const before = await preview()
    mocks.catalog.mockResolvedValue(
      createAccessRequestCatalog({
        integrations: [],
        providers: [{ id: 'replacement-provider', label: 'Replacement provider' }],
        models: [{ id: 'gpt-example', label: 'Example model', providerId: 'replacement-provider' }],
        tools: [],
        knowledgeConnectors: [],
      })
    )
    queueWorkspace()
    await expect(
      resolveAccessRequest.execute({
        principal,
        input: { ...input, decision: { action: 'apply', expectedFingerprint: before.fingerprint } },
      })
    ).rejects.toThrow('Review the updated preview')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.outbox).not.toHaveBeenCalled()
  })

  it('refuses an approval after the requester leaves and rejoins', async () => {
    const before = await preview()
    mocks.membership.mockResolvedValue({ membershipId: 'new-membership', role: 'read' })
    queueWorkspace()
    await expect(
      resolveAccessRequest.execute({
        principal,
        input: { ...input, decision: { action: 'apply', expectedFingerprint: before.fingerprint } },
      })
    ).rejects.toThrow('membership changed')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.outbox).not.toHaveBeenCalled()
  })

  it('rejects a newly imposed deployment ceiling before writing a group policy', async () => {
    const before = await preview()
    mocks.deploymentReason.mockReturnValue('Disabled by this deployment.')
    queueWorkspace()
    await expect(
      resolveAccessRequest.execute({
        principal,
        input: { ...input, decision: { action: 'apply', expectedFingerprint: before.fingerprint } },
      })
    ).rejects.toThrow('Disabled by this deployment')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('applies the complete group patch, durable decision, and outbox with one executor', async () => {
    const before = await preview()
    queueWorkspace()
    dbChainMockFns.returning.mockResolvedValueOnce([stored({ status: 'fulfilled' })])
    const result = await resolveAccessRequest.execute({
      principal,
      input: { ...input, decision: { action: 'apply', expectedFingerprint: before.fingerprint } },
    })
    expect(result.request.status).toBe('fulfilled')
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.update.mock.calls.map(([table]) => table)).toEqual([
      permissionGroup,
      permissionAccessRequest,
    ])
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          ...group.config,
          allowedModelProviders: ['openai'],
          deniedModels: ['keep-denied'],
        },
      })
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'fulfilled',
        decision: expect.objectContaining({
          changes: before.changes,
          impact,
          group: { id: 'group', name: 'Restricted group' },
        }),
      })
    )
    expect(mocks.membership).toHaveBeenLastCalledWith(
      db,
      'requester',
      { kind: 'workspace', workspaceId: 'workspace' },
      'organization',
      true
    )
    expect(mocks.outbox).toHaveBeenCalledWith(db, PERMISSION_ACCESS_REQUEST_DECIDED_EVENT, {
      requestId: 'request',
    })
    expect(mocks.setLimit).not.toHaveBeenCalled()
  })

  it('blocks approval while requests are disabled but still permits an explicit decline', async () => {
    const before = await preview()
    mocks.enabled.mockResolvedValue(false)
    queueWorkspace()
    await expect(
      resolveAccessRequest.execute({
        principal,
        input: { ...input, decision: { action: 'apply', expectedFingerprint: before.fingerprint } },
      })
    ).rejects.toThrow('turned off')
    dbChainMockFns.returning.mockResolvedValueOnce([
      stored({ status: 'declined', decisionReason: 'Use the existing provider.' }),
    ])
    const result = await resolveAccessRequest.execute({
      principal,
      input: { ...input, decision: { action: 'decline', reason: 'Use the existing provider.' } },
    })
    expect(result.request.status).toBe('declined')
    expect(dbChainMockFns.update).not.toHaveBeenCalledWith(permissionGroup)
    expect(mocks.outbox).toHaveBeenCalledOnce()
  })

  it.each(['workspace', null])(
    'attributes a declined request to its stored scope %s',
    async (workspaceId) => {
      mocks.stored.mockResolvedValue(stored({ workspaceId }))
      dbChainMockFns.returning.mockResolvedValueOnce([stored({ workspaceId, status: 'declined' })])
      await resolveAccessRequest.execute({
        principal,
        input: { ...input, decision: { action: 'decline', reason: 'Use the existing provider.' } },
      })
      expect(mocks.audit.mock.calls[0][4]).toEqual([
        expect.objectContaining({
          action: AuditAction.PERMISSION_ACCESS_REQUEST_DECLINED,
          workspaceId,
        }),
      ])
    }
  )

  it('keeps request fulfillment workspace-scoped and the group change organization-scoped', async () => {
    const before = await preview()
    queueWorkspace()
    dbChainMockFns.returning.mockResolvedValueOnce([stored({ status: 'fulfilled' })])
    await resolveAccessRequest.execute({
      principal,
      input: { ...input, decision: { action: 'apply', expectedFingerprint: before.fingerprint } },
    })
    const [, defaultWorkspaceId, , , entries] = mocks.audit.mock.calls[0]
    expect(defaultWorkspaceId).toBeNull()
    expect(entries).toEqual([
      expect.objectContaining({
        action: AuditAction.PERMISSION_ACCESS_REQUEST_FULFILLED,
        workspaceId: 'workspace',
      }),
      expect.objectContaining({ action: AuditAction.PERMISSION_GROUP_UPDATED }),
    ])
    expect(entries[1]).not.toHaveProperty('workspaceId')
  })

  it('does not apply or notify a second time after resolution', async () => {
    mocks.stored.mockResolvedValue(stored({ status: 'fulfilled' }))
    const result = await resolveAccessRequest.execute({
      principal,
      input: { ...input, decision: { action: 'apply', expectedFingerprint: 'obsolete' } },
    })
    expect(result.changed).toBe(false)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.outbox).not.toHaveBeenCalled()
    expect(mocks.catalog).not.toHaveBeenCalled()
    expect(mocks.audit.mock.calls[0][4]).toEqual([])
  })

  it('reads fulfilled history from its stored decision without rebuilding the catalog', async () => {
    const decision = {
      resolutionKind: 'permission',
      changes: [{ configKey: 'hideTablesTab', label: 'Tables', before: true, after: false }],
      impact,
      group: { id: 'original-group', name: 'Original group' },
      currentLimitCredits: null,
      newLimitCredits: null,
      fingerprint: 'original-preview',
    }
    mocks.stored.mockResolvedValue(stored({ status: 'fulfilled', decision }))
    const result = await previewAccessRequest.execute({ principal, input })
    expect(result).toMatchObject({ ...decision, canApply: false })
    expect(mocks.catalog).not.toHaveBeenCalled()
    expect(mocks.membership).not.toHaveBeenCalled()
    expect(mocks.group).not.toHaveBeenCalled()
  })
})

describe('member limit review', () => {
  beforeEach(() => {
    mocks.stored.mockResolvedValue(
      stored({
        workspaceId: null,
        target: { kind: 'usage_limit', id: 'member' },
        targetKey: 'usage_limit:member',
        scopeKey: 'organization:organization:member-limit',
        groupId: null,
        groupName: null,
      })
    )
  })

  it.each([undefined, 2000, 1999, 2000.5])(
    'requires a whole-number limit greater than the current value (%s)',
    async (newLimitCredits) => {
      queueLimit(2000)
      const before = await previewAccessRequest.execute({ principal, input })
      queueLimit(2000)
      await expect(
        resolveAccessRequest.execute({
          principal,
          input: {
            ...input,
            decision: { action: 'apply', expectedFingerprint: before.fingerprint, newLimitCredits },
          },
        })
      ).rejects.toThrow('greater than the current limit')
      expect(mocks.setLimit).not.toHaveBeenCalled()
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    }
  )

  it('changes the requester cap in stored dollars without changing group policy', async () => {
    queueLimit(2000)
    const before = await previewAccessRequest.execute({ principal, input })
    expect(before).toMatchObject({
      resolutionKind: 'usage_limit',
      group: null,
      currentLimitCredits: 2000,
      canApply: true,
    })
    queueLimit(2000)
    dbChainMockFns.returning.mockResolvedValueOnce([
      stored({
        workspaceId: null,
        status: 'fulfilled',
        target: { kind: 'usage_limit', id: 'member' },
      }),
    ])
    await resolveAccessRequest.execute({
      principal,
      input: {
        ...input,
        decision: {
          action: 'apply',
          expectedFingerprint: before.fingerprint,
          newLimitCredits: 3000,
        },
      },
    })
    expect(mocks.setLimit).toHaveBeenCalledWith('organization', 'requester', 15, 'admin', db)
    expect(dbChainMockFns.update).not.toHaveBeenCalledWith(permissionGroup)
    const [, defaultWorkspaceId, , , entries] = mocks.audit.mock.calls[0]
    expect(defaultWorkspaceId).toBeNull()
    expect(entries).toEqual([
      expect.objectContaining({
        action: AuditAction.PERMISSION_ACCESS_REQUEST_FULFILLED,
        workspaceId: null,
      }),
      expect.objectContaining({ action: AuditAction.ORG_MEMBER_USAGE_LIMIT_CHANGED }),
    ])
    expect(entries[1]).not.toHaveProperty('workspaceId')
    expect(mocks.outbox).toHaveBeenCalledWith(db, PERMISSION_ACCESS_REQUEST_DECIDED_EVENT, {
      requestId: 'request',
    })
  })

  it('requires another review if the current cap changes after preview', async () => {
    queueLimit(2000)
    const before = await previewAccessRequest.execute({ principal, input })
    queueLimit(2500)
    await expect(
      resolveAccessRequest.execute({
        principal,
        input: {
          ...input,
          decision: {
            action: 'apply',
            expectedFingerprint: before.fingerprint,
            newLimitCredits: 3000,
          },
        },
      })
    ).rejects.toThrow('Review the updated preview')
    expect(mocks.setLimit).not.toHaveBeenCalled()
    expect(mocks.outbox).not.toHaveBeenCalled()
  })
})
