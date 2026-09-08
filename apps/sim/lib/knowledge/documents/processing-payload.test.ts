/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  assertDocumentProcessingBillingContext,
  assertDocumentProcessingPayload,
  createDocumentProcessingPayload,
  createOrganizationDocumentProcessingBillingContext,
  createWorkspaceDocumentProcessingBillingContext,
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
  it('preserves the real actor, organization and queue generation through replay', () => {
    const context = createOrganizationDocumentProcessingBillingContext(attribution)
    const payload = createDocumentProcessingPayload(document, context)
    expect(assertDocumentProcessingPayload(structuredClone(payload))).toEqual(payload)
    expect(payload.actorUserId).toBe('reader')
    expect(payload).toMatchObject({ organizationId: 'organization-a', workspaceId: null })
  })

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

  it('preserves existing organization-billed workspace processing', () => {
    const context = createWorkspaceDocumentProcessingBillingContext({
      ...attribution,
      workspaceId: 'workspace-a',
    })
    expect(assertDocumentProcessingBillingContext(context)).toEqual(context)
    expect(context.billingScope).toBe('workspace')
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
