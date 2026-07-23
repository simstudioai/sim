/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  defaultMockEnv,
  resetDbChainMock,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'

const { mockBatchTrigger } = vi.hoisted(() => ({
  mockBatchTrigger: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  tasks: {
    batchTrigger: mockBatchTrigger,
  },
}))
vi.mock('@/lib/core/async-jobs/region', () => ({
  resolveTriggerRegion: vi.fn().mockResolvedValue('us-east-1'),
}))
/**
 * Under `isolate: false` the shared `@/lib/knowledge/embeddings` /
 * `documents/service` modules may be cached bound to the REAL env module, so
 * mutate the real `env` object per test (restored afterAll) instead of
 * vi.mock'ing a file-local replacement a cached consumer would never see.
 */
const envSnapshot = { ...env }

afterAll(() => {
  for (const key of Object.keys(env)) {
    delete (env as Record<string, unknown>)[key]
  }
  Object.assign(env, envSnapshot)
})

import { processDocumentsWithQueue } from '@/lib/knowledge/documents/service'

const BILLING_ATTRIBUTION = {
  actorUserId: 'external-admin',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'user', id: 'workspace-owner' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
} satisfies BillingAttributionSnapshot

const DOCUMENT = {
  documentId: 'document-1',
  filename: 'document.txt',
  fileUrl: 'https://example.com/document.txt',
  fileSize: 128,
  mimeType: 'text/plain',
}

beforeAll(() => {
  setEnvFlags({ isTriggerDevEnabled: true })
})

afterAll(resetEnvFlagsMock)

describe('processDocumentsWithQueue billing attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockBatchTrigger.mockResolvedValue({ batchId: 'batch-1' })
    for (const key of Object.keys(env)) {
      delete (env as Record<string, unknown>)[key]
    }
    Object.assign(env, { ...defaultMockEnv, TRIGGER_SECRET_KEY: 'trigger-secret' })
  })

  it('validates and preserves workspace attribution before enqueue', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { userId: 'knowledge-owner', workspaceId: 'workspace-1' },
    ])

    await processDocumentsWithQueue(
      [DOCUMENT],
      'knowledge-base-1',
      {},
      'request-1',
      BILLING_ATTRIBUTION
    )

    const jobs = mockBatchTrigger.mock.calls[0][1]
    expect(structuredClone(jobs[0].payload)).toEqual({
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
      billingScope: 'workspace',
      actorUserId: 'external-admin',
      workspaceId: 'workspace-1',
      billingAttribution: BILLING_ATTRIBUTION,
    })
  })

  it('rejects missing workspace attribution without enqueueing', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { userId: 'knowledge-owner', workspaceId: 'workspace-1' },
    ])

    await expect(
      processDocumentsWithQueue([DOCUMENT], 'knowledge-base-1', {}, 'request-1', undefined)
    ).rejects.toThrow('Workspace document processing requires a billing attribution snapshot')
    expect(mockBatchTrigger).not.toHaveBeenCalled()
  })

  it('rejects mismatched workspace attribution without enqueueing', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { userId: 'knowledge-owner', workspaceId: 'workspace-2' },
    ])

    await expect(
      processDocumentsWithQueue(
        [DOCUMENT],
        'knowledge-base-1',
        {},
        'request-1',
        BILLING_ATTRIBUTION
      )
    ).rejects.toThrow('Document processing workspace does not match billing attribution')
    expect(mockBatchTrigger).not.toHaveBeenCalled()
  })

  it('enqueues workspace-less knowledge bases with an explicit non-workspace payload', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ userId: 'legacy-owner', workspaceId: null }])

    await processDocumentsWithQueue([DOCUMENT], 'knowledge-base-1', {}, 'request-1', undefined)

    const jobs = mockBatchTrigger.mock.calls[0][1]
    expect(jobs[0].payload).toMatchObject({
      billingScope: 'non-workspace',
      actorUserId: 'legacy-owner',
      workspaceId: null,
    })
    expect(jobs[0].payload).not.toHaveProperty('billingAttribution')
  })
})
