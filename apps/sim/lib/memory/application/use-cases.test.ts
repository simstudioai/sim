import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { billingAttributionMock } from '@sim/testing/mocks/billing-attribution.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'

const hoisted = vi.hoisted(() => ({
  readBoundProvenance: vi.fn(),
  readPlainMemoryTail: vi.fn(),
}))

vi.mock('@/lib/memory/conversation-store', () => ({
  readPlainMemoryTail: hoisted.readPlainMemoryTail,
  appendMemoryMessages: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

vi.mock('@/lib/memory/secret-provenance', () => ({
  readBoundMemorySecretProvenance: hoisted.readBoundProvenance,
  replaceMemorySecretProvenanceInTx: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

import { listMemoriesUseCase } from '@/lib/memory/application/use-cases'
import type { PlainMemoryReadBudget } from '@/lib/memory/read-budget'

const mocks = {
  ...hoisted,
  loadWorkspace: workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

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

const ACTORLESS_DEPLOYED_PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  workspaceId: WORKSPACE_ID,
  delegationId: 'delegation-1',
  audience: 'sim:memory',
  issuedAt: new Date(Date.now() - 1_000),
  expiresAt: new Date(Date.now() + 60_000),
  delegationContext: {
    kind: 'workflow_execution',
    workflowId: 'workflow-1',
    executionId: 'execution-1',
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
  },
}

describe('Memory application use cases', () => {
  beforeEach(() => {
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
  })
  it('enforces one appended-history budget across the entire list response', async () => {
    queueTableRows(
      schemaMock.memory,
      [1, 2, 3].map((index) => ({
        id: `memory-${index}`,
        key: `conversation-${index}`,
        data: [],
        storageVersion: 2,
        secretProvenanceVersion: null,
      }))
    )
    mocks.readPlainMemoryTail.mockImplementation(
      async (_id: string, _workspaceId: string, budget: PlainMemoryReadBudget) => {
        budget.reserve(6000, 1024)
        return { messages: [], provenance: { status: 'exact', entries: [] } }
      }
    )
    await expect(
      listMemoriesUseCase.execute({
        principal: ACTORLESS_DEPLOYED_PRINCIPAL,
        input: { workspaceId: WORKSPACE_ID, limit: 50 },
      })
    ).rejects.toMatchObject({ code: 'payload_too_large' })
    expect(mocks.readPlainMemoryTail).toHaveBeenCalledTimes(2)
    expect(mocks.readPlainMemoryTail.mock.calls[0][2]).toBe(
      mocks.readPlainMemoryTail.mock.calls[1][2]
    )
  })
})
