/**
 * @vitest-environment node
 */

import { dbChainMock, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  reportUnrecorded: vi.fn(),
  readBoundProvenance: vi.fn(),
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: (value: unknown) => value,
}))

vi.mock('@/lib/execution/durable-secret-provenance-enforcement', () => ({
  isDurableSecretProvenanceEnforced: () => false,
  reportUnrecordedDurableProvenance: mocks.reportUnrecorded,
}))

vi.mock('@/lib/memory/secret-provenance', () => ({
  readBoundMemorySecretProvenance: mocks.readBoundProvenance,
  replaceMemorySecretProvenanceInTx: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

import { listMemoriesUseCase } from '@/lib/memory/application/use-cases'

const WORKSPACE_ID = 'workspace-canonical'
const BILLING_OWNER_ID = 'billing-owner'
const BILLING_ATTRIBUTION: BillingAttributionSnapshot = {
  actorUserId: BILLING_OWNER_ID,
  workspaceId: WORKSPACE_ID,
  organizationId: null,
  billedAccountUserId: BILLING_OWNER_ID,
  billingEntity: { type: 'user', id: BILLING_OWNER_ID },
  billingPeriod: {
    start: '2026-08-01T00:00:00.000Z',
    end: '2026-09-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

const ACTORLESS_DEPLOYED_PRINCIPAL = createTestRuntimePrincipal({
  principal: {
    kind: 'system',
    serviceId: 'schedule',
    workspaceId: WORKSPACE_ID,
    workflowId: 'workflow-1',
  },
  currentWorkflow: {
    workflowId: 'workflow-1',
    mode: 'deployment',
    deploymentVersionId: 'deployment-1',
  },
})

describe('Memory application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.loadWorkspace.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: BILLING_OWNER_ID,
    })
    mocks.readBoundProvenance.mockReturnValue({ status: 'unknown' })
  })

  it('authorizes an actorless deployment before using signed billing for legacy provenance', async () => {
    const record = {
      id: 'memory-1',
      key: 'conversation-1',
      data: [{ role: 'user', content: 'hello' }],
      secretProvenanceVersion: null,
    }
    queueTableRows(schemaMock.memory, [record])
    queueTableRows(schemaMock.memorySecretProvenance, [])
    const resolveBillingAttribution = vi.fn(async () => BILLING_ATTRIBUTION)

    const result = await listMemoriesUseCase.execute({
      principal: ACTORLESS_DEPLOYED_PRINCIPAL,
      input: {
        workspaceId: WORKSPACE_ID,
        limit: 50,
        includePersistedSecretProvenance: true,
        resolveBillingAttribution,
      },
    })

    expect(mocks.loadWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      resolveBillingAttribution.mock.invocationCallOrder[0]
    )
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(resolveBillingAttribution).toHaveBeenCalledWith(WORKSPACE_ID)
    expect(result.provenanceScope).toEqual({
      userId: BILLING_OWNER_ID,
      workspaceId: WORKSPACE_ID,
    })
    expect(mocks.reportUnrecorded).toHaveBeenCalledWith({
      surface: 'memory',
      cause: 'durable-provenance-unknown',
      affectedCount: 1,
      workspaceId: WORKSPACE_ID,
      actorUserId: BILLING_OWNER_ID,
    })
  })

  it('rejects billing attribution outside the authorized canonical workspace', async () => {
    const record = {
      id: 'memory-1',
      key: 'conversation-1',
      data: [{ role: 'user', content: 'hello' }],
      secretProvenanceVersion: null,
    }
    queueTableRows(schemaMock.memory, [record])
    const resolveBillingAttribution = vi.fn(
      async (): Promise<BillingAttributionSnapshot> => ({
        ...BILLING_ATTRIBUTION,
        workspaceId: 'workspace-other',
      })
    )

    await expect(
      listMemoriesUseCase.execute({
        principal: ACTORLESS_DEPLOYED_PRINCIPAL,
        input: {
          workspaceId: WORKSPACE_ID,
          limit: 50,
          includePersistedSecretProvenance: true,
          resolveBillingAttribution,
        },
      })
    ).rejects.toThrow('Memory billing attribution does not match its canonical workspace')

    expect(mocks.loadWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      resolveBillingAttribution.mock.invocationCallOrder[0]
    )
    expect(mocks.readBoundProvenance).not.toHaveBeenCalled()
    expect(mocks.reportUnrecorded).not.toHaveBeenCalled()
  })
})
