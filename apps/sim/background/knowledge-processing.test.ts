/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAssertBillingAttributionSnapshot, mockProcessDocumentAsync, mockTask } = vi.hoisted(
  () => ({
    mockAssertBillingAttributionSnapshot: vi.fn(),
    mockProcessDocumentAsync: vi.fn(),
    mockTask: vi.fn((config) => config),
  })
)

vi.mock('@trigger.dev/sdk', () => ({ task: mockTask }))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: mockAssertBillingAttributionSnapshot,
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  processDocumentAsync: mockProcessDocumentAsync,
}))

import { runDocumentProcessing } from '@/background/knowledge-processing'

const BILLING_ATTRIBUTION = {
  actorUserId: 'external-admin',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'user' as const, id: 'workspace-owner' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

const BASE_PAYLOAD = {
  knowledgeBaseId: 'knowledge-base-1',
  documentId: 'document-1',
  docData: {
    filename: 'document.txt',
    fileUrl: 'https://example.com/document.txt',
    fileSize: 128,
    mimeType: 'text/plain',
  },
  processingOptions: {},
  requestId: 'request-1',
}

const WORKSPACE_PAYLOAD = {
  ...BASE_PAYLOAD,
  billingScope: 'workspace' as const,
  actorUserId: 'external-admin',
  workspaceId: 'workspace-1',
  billingAttribution: BILLING_ATTRIBUTION,
}

describe('knowledge processing worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertBillingAttributionSnapshot.mockImplementation((value) => {
      if (!value) {
        throw new Error('Billing attribution snapshot must be an object')
      }
      return value
    })
    mockProcessDocumentAsync.mockResolvedValue(undefined)
  })

  it('rejects workspace work without attribution before document processing starts', async () => {
    await expect(
      runDocumentProcessing({
        ...BASE_PAYLOAD,
        billingScope: 'workspace',
        actorUserId: 'external-admin',
        workspaceId: 'workspace-1',
      })
    ).rejects.toThrow('Workspace document processing requires a billing attribution snapshot')
    expect(mockProcessDocumentAsync).not.toHaveBeenCalled()
  })

  it('preserves the validated actor and payer snapshot through serialization', async () => {
    await runDocumentProcessing(structuredClone(WORKSPACE_PAYLOAD))

    expect(mockProcessDocumentAsync).toHaveBeenCalledWith(
      'knowledge-base-1',
      'document-1',
      BASE_PAYLOAD.docData,
      {},
      {
        billingScope: 'workspace',
        actorUserId: 'external-admin',
        workspaceId: 'workspace-1',
        billingAttribution: BILLING_ATTRIBUTION,
      }
    )
  })

  it('rejects an actor mismatch before document processing starts', async () => {
    await expect(
      runDocumentProcessing({
        ...WORKSPACE_PAYLOAD,
        actorUserId: 'different-actor',
      })
    ).rejects.toThrow('Document processing actor does not match billing attribution')
    expect(mockProcessDocumentAsync).not.toHaveBeenCalled()
  })

  it('rejects a workspace mismatch before document processing starts', async () => {
    await expect(
      runDocumentProcessing({
        ...WORKSPACE_PAYLOAD,
        workspaceId: 'workspace-2',
      })
    ).rejects.toThrow('Document processing workspace does not match billing attribution')
    expect(mockProcessDocumentAsync).not.toHaveBeenCalled()
  })

  it('preserves explicit non-workspace processing without workspace attribution', async () => {
    await runDocumentProcessing({
      ...BASE_PAYLOAD,
      billingScope: 'non-workspace',
      actorUserId: 'legacy-owner',
      workspaceId: null,
    })

    expect(mockProcessDocumentAsync).toHaveBeenCalledWith(
      'knowledge-base-1',
      'document-1',
      BASE_PAYLOAD.docData,
      {},
      {
        billingScope: 'non-workspace',
        actorUserId: 'legacy-owner',
        workspaceId: null,
      }
    )
  })
})
