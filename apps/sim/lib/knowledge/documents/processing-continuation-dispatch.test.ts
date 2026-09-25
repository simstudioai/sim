import { describe, expect, it, vi } from 'vitest'

const { mockTrigger, mockResolveTriggerRegion } = vi.hoisted(() => ({
  mockTrigger: vi.fn(),
  mockResolveTriggerRegion: vi.fn().mockResolvedValue('us-east-1'),
}))

vi.mock('@trigger.dev/sdk', () => ({ tasks: { trigger: mockTrigger } }))
vi.mock('@/lib/core/async-jobs/region', () => ({
  resolveTriggerRegion: mockResolveTriggerRegion,
}))

import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { dispatchDocumentProcessingContinuation } from '@/lib/knowledge/documents/processing-continuation-dispatch'
import type {
  DocumentProcessingLane,
  DocumentProcessingPayload,
} from '@/lib/knowledge/documents/processing-payload'

const BILLING_ATTRIBUTION = {
  actorUserId: 'user-1',
  workspaceId: null,
  organizationId: 'org-1',
  billedAccountUserId: 'owner-1',
  billingEntity: { type: 'organization', id: 'org-1' },
  billingPeriod: { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
  payerSubscription: null,
} satisfies BillingAttributionSnapshot

function payload(lane: DocumentProcessingLane): DocumentProcessingPayload {
  return {
    knowledgeBaseId: 'knowledge-base-1',
    documentId: 'document-1',
    processingLane: lane,
    docData: { filename: 'a.txt', fileUrl: '/a.txt', fileSize: 1, mimeType: 'text/plain' },
    processingOptions: {},
    requestId: 'request-1',
    billingScope: 'organization',
    actorUserId: 'user-1',
    workspaceId: null,
    organizationId: 'org-1',
    billingAttribution: BILLING_ATTRIBUTION,
  }
}

describe('dispatchDocumentProcessingContinuation', () => {
  /**
   * A deferred backfill document resuming as interactive work would be a way
   * around the tenant's backfill ceiling: every quota or capacity deferral
   * would promote one more run into the lane a person's upload is waiting in.
   */
  it.each([
    ['backfill', 'document-processing-backfill-queue'],
    ['interactive', 'document-processing-queue'],
  ] as const)('resumes a %s document in the same lane', async (lane, expectedQueue) => {
    await dispatchDocumentProcessingContinuation(
      payload(lane),
      new Date('2026-09-17T19:00:00.000Z'),
      'continuation-key',
      true
    )

    expect(mockTrigger).toHaveBeenCalledTimes(1)
    expect(mockTrigger.mock.calls[0][2]).toMatchObject({
      queue: expectedQueue,
      concurrencyKey: 'organization:org-1',
    })
  })
})
