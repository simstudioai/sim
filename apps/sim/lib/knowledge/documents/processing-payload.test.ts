import { describe, expect, it } from 'vitest'
import {
  assertDocumentProcessingBillingContext,
  assertDocumentProcessingPayload,
  createDocumentProcessingContinuationToken,
  createDocumentProcessingPayload,
  createOrganizationDocumentProcessingBillingContext,
  createWorkspaceDocumentProcessingBillingContext,
  shouldRefundDocumentProcessingPredecessor,
} from '@/lib/knowledge/documents/processing-payload'

const attribution = {
  actorUserId: 'reader',
  workspaceId: null,
  organizationId: 'organization-a',
  billedAccountUserId: 'billing-owner',
  billingEntity: { type: 'organization', id: 'organization-a' },
  billingPeriod: { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
  payerSubscription: null,
} as const

const document = {
  knowledgeBaseId: 'organization-index',
  documentId: 'document-a',
  requestId: 'queue-generation',
  processingQueueToken: 'queue-generation',
  processingQueuedAt: '2026-09-07T00:00:00.000Z',
  chargedAtDispatch: true,
  quotaRetryCount: 1,
  docData: {
    filename: 'Source.txt',
    fileUrl: '/api/files/serve/kb%2Fsource',
    fileSize: 12,
    mimeType: 'text/plain',
  },
  processingOptions: {},
}

describe('organization document queue ownership', () => {
  it.each([
    { organizationId: 'organization-b' },
    { workspaceId: 'organization-a' },
    { actorUserId: 'billing-owner' },
    { billingAttribution: { ...attribution, workspaceId: 'workspace-a' } },
    { billingAttribution: undefined },
  ])('rejects mismatched organization processing attribution: %j', (overrides) => {
    const context = createOrganizationDocumentProcessingBillingContext(attribution)
    expect(() => assertDocumentProcessingBillingContext({ ...context, ...overrides })).toThrow()
  })

  it('does not reinterpret organization attribution as workspace attribution', () => {
    expect(() => createWorkspaceDocumentProcessingBillingContext(attribution)).toThrow()
    expect(() =>
      createOrganizationDocumentProcessingBillingContext({
        ...attribution,
        workspaceId: 'workspace-a',
      })
    ).toThrow()
  })

  it('accepts an exact same-pass predecessor and refunds only the original admission', () => {
    const payload = createDocumentProcessingPayload(
      document,
      createOrganizationDocumentProcessingBillingContext(attribution)
    )
    payload.processingPredecessorToken = payload.processingQueueToken
    payload.processingPredecessorCharged = true
    payload.processingQueueToken = createDocumentProcessingContinuationToken(payload, 'quota', 1)
    expect(assertDocumentProcessingPayload(payload).processingPredecessorToken).toBe(
      'queue-generation'
    )
    expect(shouldRefundDocumentProcessingPredecessor(payload)).toBe(true)
    expect(() =>
      assertDocumentProcessingPayload({ ...payload, processingPredecessorToken: 'unrelated-pass' })
    ).toThrow(/predecessor/)
    expect(() =>
      assertDocumentProcessingPayload({
        ...payload,
        processingPredecessorToken: payload.processingQueueToken,
      })
    ).toThrow(/predecessor/)
    expect(
      shouldRefundDocumentProcessingPredecessor({ ...payload, processingPredecessorCharged: false })
    ).toBe(false)
  })

  it('refuses stale or corrupted queue generation metadata during replay', () => {
    const payload = createDocumentProcessingPayload(
      document,
      createOrganizationDocumentProcessingBillingContext(attribution)
    )
    expect(() =>
      assertDocumentProcessingPayload({ ...payload, processingQueueToken: 'old-generation' })
    ).toThrow()
    expect(() =>
      assertDocumentProcessingPayload({ ...payload, processingQueuedAt: undefined })
    ).toThrow()
  })
})
