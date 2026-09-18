/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BACKFILL_PROCESSING_QUEUE_NAME,
  documentProcessingQueueOptions,
  documentProcessingRunExpiry,
  INTERACTIVE_PROCESSING_QUEUE_NAME,
} from '@/lib/knowledge/documents/processing-lane'
import type { DocumentProcessingPayload } from '@/lib/knowledge/documents/processing-payload'
import { resolveDocumentProcessingLane } from '@/lib/knowledge/documents/processing-payload'
import {
  QUEUED_DISPATCH_GRACE_MS,
  QUEUED_DISPATCH_START_DEADLINE_MS,
} from '@/lib/knowledge/documents/types'

const BILLING_ATTRIBUTION = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'owner-1',
  billingEntity: { type: 'user' as const, id: 'owner-1' },
  billingPeriod: { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
  payerSubscription: null,
}

const BASE = {
  knowledgeBaseId: 'knowledge-base-1',
  documentId: 'document-1',
  processingLane: 'interactive',
  docData: { filename: 'a.txt', fileUrl: '/a.txt', fileSize: 1, mimeType: 'text/plain' },
  processingOptions: {},
  requestId: 'request-1',
} satisfies Partial<DocumentProcessingPayload>

function workspacePayload(
  overrides: Partial<DocumentProcessingPayload> = {}
): DocumentProcessingPayload {
  return {
    ...BASE,
    billingScope: 'workspace',
    actorUserId: 'user-1',
    workspaceId: 'workspace-1',
    billingAttribution: BILLING_ATTRIBUTION,
    ...overrides,
  }
}

function organizationPayload(organizationId: string): DocumentProcessingPayload {
  return {
    ...BASE,
    processingLane: 'backfill',
    billingScope: 'organization',
    actorUserId: 'user-1',
    workspaceId: null,
    organizationId,
    billingAttribution: { ...BILLING_ATTRIBUTION, workspaceId: null, organizationId },
  }
}

describe('resolveDocumentProcessingLane', () => {
  it('keeps an explicit interactive stamp', () => {
    expect(resolveDocumentProcessingLane('interactive')).toBe('interactive')
  })

  /**
   * Payloads written before the lanes existed carry no lane, and a rolling
   * deploy can hand this version one stamped by a newer. Neither may throw:
   * failing the run would burn its retry budget for the length of a rollout.
   */
  it.each([undefined, null, '', 'backfill', 'express', 42, {}, 'Interactive', ' interactive'])(
    'reads %p as backfill rather than throwing or widening',
    (value) => {
      expect(resolveDocumentProcessingLane(value)).toBe('backfill')
    }
  )
})

describe('documentProcessingQueueOptions', () => {
  it('routes interactive work to the interactive queue keyed by workspace', () => {
    expect(documentProcessingQueueOptions(workspacePayload())).toEqual({
      queue: INTERACTIVE_PROCESSING_QUEUE_NAME,
      concurrencyKey: 'workspace:workspace-1',
    })
  })

  it('routes backfill to its own queue under the same key', () => {
    expect(
      documentProcessingQueueOptions(workspacePayload({ processingLane: 'backfill' }))
    ).toEqual({
      queue: BACKFILL_PROCESSING_QUEUE_NAME,
      concurrencyKey: 'workspace:workspace-1',
    })
  })

  /**
   * The incident this split exists for: organization-scoped knowledge bases
   * carry `workspaceId: null`, so a workspace-only key would collapse every one
   * of them onto a single shared queue and starve the rest of the fleet again.
   */
  it('keys an organization-owned knowledge base on its organization', () => {
    expect(documentProcessingQueueOptions(organizationPayload('org-1')).concurrencyKey).toBe(
      'organization:org-1'
    )
  })

  it('keys a knowledge base with no workspace or organization on its actor', () => {
    const payload: DocumentProcessingPayload = {
      ...BASE,
      billingScope: 'non-workspace',
      actorUserId: 'user-9',
      workspaceId: null,
    }
    expect(documentProcessingQueueOptions(payload).concurrencyKey).toBe('user:user-9')
  })

  it('puts two tenants in the same lane on separate keys', () => {
    const first = documentProcessingQueueOptions(organizationPayload('org-1'))
    const second = documentProcessingQueueOptions(organizationPayload('org-2'))
    expect(first.queue).toBe(second.queue)
    expect(first.concurrencyKey).not.toBe(second.concurrencyKey)
  })

  it('keeps an organization and a workspace sharing an id on separate keys', () => {
    expect(
      documentProcessingQueueOptions(organizationPayload('shared-id')).concurrencyKey
    ).not.toBe(
      documentProcessingQueueOptions(
        workspacePayload({
          workspaceId: 'shared-id',
          billingAttribution: { ...BILLING_ATTRIBUTION, workspaceId: 'shared-id' },
        })
      ).concurrencyKey
    )
  })
})

describe('documentProcessingRunExpiry', () => {
  const NOW = new Date('2026-09-18T12:00:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('expires an undelayed run at the start deadline, before recovery may replace it', () => {
    expect(QUEUED_DISPATCH_START_DEADLINE_MS).toBeLessThan(QUEUED_DISPATCH_GRACE_MS)
    expect(documentProcessingRunExpiry({ processingQueuedAt: NOW.toISOString() })).toEqual({
      ttl: QUEUED_DISPATCH_START_DEADLINE_MS / 1000,
    })
  })

  it('gives a late relay only the time its generation has left', () => {
    const stampedAt = new Date(NOW.getTime() - 60 * 60_000)
    expect(documentProcessingRunExpiry({ processingQueuedAt: stampedAt.toISOString() })).toEqual({
      ttl: (QUEUED_DISPATCH_START_DEADLINE_MS - 60 * 60_000) / 1000,
    })
  })

  it('expires a generation already past its deadline at the minimum', () => {
    const stampedAt = new Date(NOW.getTime() - QUEUED_DISPATCH_GRACE_MS)
    expect(documentProcessingRunExpiry({ processingQueuedAt: stampedAt.toISOString() })).toEqual({
      ttl: 1,
    })
  })

  /** Trigger.dev starts a delayed run's TTL when its delay ends, not when it is triggered. */
  it('counts a delayed run from the end of its delay', () => {
    const deferredUntil = new Date(NOW.getTime() + 30 * 60_000)
    expect(
      documentProcessingRunExpiry(
        { processingQueuedAt: deferredUntil.toISOString() },
        deferredUntil
      )
    ).toEqual({ ttl: QUEUED_DISPATCH_START_DEADLINE_MS / 1000 })
  })

  it('leaves a payload without a queue stamp on the queue default', () => {
    expect(documentProcessingRunExpiry({})).toEqual({})
  })
})
