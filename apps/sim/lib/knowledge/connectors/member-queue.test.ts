/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAssertBillingOwner,
  mockExecuteMemberSync,
  mockIsTriggerAvailable,
  mockTrigger,
  mockResolveRegion,
  mockResolveSystemBilling,
} = vi.hoisted(() => ({
  mockAssertBillingOwner: vi.fn(),
  mockExecuteMemberSync: vi.fn(),
  mockIsTriggerAvailable: vi.fn(),
  mockTrigger: vi.fn(),
  mockResolveRegion: vi.fn(),
  mockResolveSystemBilling: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionOwner: mockAssertBillingOwner,
  assertBillingAttributionSnapshot: (value: unknown) => value,
  resolveSystemBillingAttribution: mockResolveSystemBilling,
}))
vi.mock('@/lib/knowledge/connectors/member-sync-engine', () => ({
  executeMemberSync: mockExecuteMemberSync,
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  isTriggerAvailable: mockIsTriggerAvailable,
}))
vi.mock('@trigger.dev/sdk', () => ({
  tasks: { trigger: mockTrigger },
  idempotencyKeys: { create: vi.fn(async (key: string) => key) },
}))
vi.mock('@/lib/core/async-jobs/region', () => ({ resolveTriggerRegion: mockResolveRegion }))

import { eq, inArray } from 'drizzle-orm'
import {
  assertMemberSyncPayload,
  dispatchMemberSync,
  dispatchMemberSyncsForCredentialOption,
  MEMBER_SYNC_TASK_ID,
} from '@/lib/knowledge/connectors/member-queue'

const BILLING = {
  actorUserId: 'user-1',
  workspaceId: 'ws-1',
  organizationId: null,
  billedAccountUserId: 'owner-1',
  billingEntity: { type: 'user' as const, id: 'owner-1' },
  billingPeriod: { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
  payerSubscription: null,
}

const CONNECTOR_ROW = {
  knowledgeBaseId: 'kb-1',
  accessMode: 'members',
  status: 'active',
  memberSyncStatus: 'idle',
  nextMemberSyncAt: null,
  archivedAt: null,
  deletedAt: null,
  workspaceId: 'ws-1',
  kbDeletedAt: null,
}

describe('member sync queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockIsTriggerAvailable.mockReturnValue(true)
    mockResolveRegion.mockResolvedValue('us')
    mockExecuteMemberSync.mockResolvedValue({})
  })

  describe('assertMemberSyncPayload', () => {
    it('restores a well-formed payload', () => {
      expect(
        assertMemberSyncPayload({
          connectorId: 'c-1',
          requestId: 'r-1',
          billingAttribution: BILLING,
          dispatchToken: 't-1',
          forceContentRefresh: true,
        })
      ).toEqual({
        connectorId: 'c-1',
        requestId: 'r-1',
        billingAttribution: BILLING,
        dispatchToken: 't-1',
        forceContentRefresh: true,
      })
    })

    it.each([
      ['no connector', { requestId: 'r-1', billingAttribution: BILLING }],
      ['no request id', { connectorId: 'c-1', billingAttribution: BILLING }],
      ['no billing attribution', { connectorId: 'c-1', requestId: 'r-1' }],
      [
        'non-boolean content refresh',
        {
          connectorId: 'c-1',
          requestId: 'r-1',
          billingAttribution: BILLING,
          forceContentRefresh: 'yes',
        },
      ],
      [
        'a blank token',
        { connectorId: 'c-1', requestId: 'r-1', billingAttribution: BILLING, dispatchToken: ' ' },
      ],
    ])('rejects a payload with %s', (_name, payload) => {
      expect(() => assertMemberSyncPayload(payload)).toThrow()
    })
  })

  describe('dispatchMemberSync', () => {
    it('takes the queue entry and hands the run to the queue with its token', async () => {
      queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR_ROW])
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'c-1' }])

      await expect(
        dispatchMemberSync('c-1', { billingAttribution: BILLING, requestId: 'r-1' })
      ).resolves.toEqual({ queued: true })

      expect(mockTrigger).toHaveBeenCalledWith(
        MEMBER_SYNC_TASK_ID,
        expect.objectContaining({
          connectorId: 'c-1',
          requestId: 'r-1',
          dispatchToken: expect.any(String),
          forceContentRefresh: true,
        }),
        expect.objectContaining({ region: 'us' })
      )
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({
          memberSyncStatus: 'pending',
          memberSyncLockToken: expect.any(String),
        })
      )
    })

    it('runs in-process with the token when the queue is unavailable', async () => {
      mockIsTriggerAvailable.mockReturnValue(false)
      queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR_ROW])
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'c-1' }])

      await expect(
        dispatchMemberSync('c-1', { billingAttribution: BILLING, requestId: 'r-1' })
      ).resolves.toEqual({ queued: true })

      expect(mockTrigger).not.toHaveBeenCalled()
      expect(mockExecuteMemberSync).toHaveBeenCalledWith(
        'c-1',
        expect.objectContaining({ billingAttribution: BILLING, dispatchToken: expect.any(String) })
      )
    })

    it('automatic permission refresh does not force another content crawl', async () => {
      const nextMemberSyncAt = new Date()
      queueTableRows(schemaMock.knowledgeConnector, [{ ...CONNECTOR_ROW, nextMemberSyncAt }])
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'c-1' }])
      await dispatchMemberSync('c-1', {
        billingAttribution: BILLING,
        requireRunnable: true,
        expectedNextMemberSyncAt: nextMemberSyncAt,
      })
      expect(mockTrigger).toHaveBeenCalledWith(
        MEMBER_SYNC_TASK_ID,
        expect.objectContaining({ forceContentRefresh: false }),
        expect.anything()
      )
    })

    it('releases its own queue entry when the hand-off throws', async () => {
      queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR_ROW])
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'c-1' }])
      mockTrigger.mockRejectedValueOnce(new Error('queue down'))

      await expect(
        dispatchMemberSync('c-1', { billingAttribution: BILLING, requestId: 'r-1' })
      ).rejects.toThrow('queue down')

      expect(dbChainMockFns.set).toHaveBeenLastCalledWith(
        expect.objectContaining({
          memberSyncStatus: 'error',
          memberSyncLockToken: null,
          memberSyncLockLeaseAt: null,
        })
      )
    })

    it.each([
      ['a workspace-mode connector', { accessMode: 'workspace' }, 'does not sync per member'],
      ['an archived connector', { archivedAt: new Date() }, 'archived or deleted'],
      [
        'a running connector on the automatic path',
        { memberSyncStatus: 'running' },
        'is running and is not run automatically',
      ],
      [
        'a changed schedule on the automatic path',
        { nextMemberSyncAt: new Date('2026-09-01T00:00:00Z') },
        'schedule changed',
      ],
    ])('refuses %s without touching the queue', async (_name, overrides, reason) => {
      queueTableRows(schemaMock.knowledgeConnector, [{ ...CONNECTOR_ROW, ...overrides }])

      const result = await dispatchMemberSync('c-1', {
        billingAttribution: BILLING,
        requestId: 'r-1',
        requireRunnable: true,
        expectedNextMemberSyncAt: new Date('2026-09-01T06:00:00Z'),
      })

      expect(result.queued).toBe(false)
      expect(result.reason).toContain(reason)
      expect(mockTrigger).not.toHaveBeenCalled()
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('explains a queue entry it could not take', async () => {
      queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR_ROW])
      dbChainMockFns.returning.mockResolvedValueOnce([])
      queueTableRows(schemaMock.knowledgeConnector, [
        {
          accessMode: 'members',
          status: 'active',
          memberSyncStatus: 'idle',
          syncLockToken: 'content-run',
          archivedAt: null,
          deletedAt: null,
        },
      ])

      await expect(
        dispatchMemberSync('c-1', { billingAttribution: BILLING, requestId: 'r-1' })
      ).resolves.toEqual({
        queued: false,
        reason: 'A workspace sync is still running for this connector',
      })
      expect(mockTrigger).not.toHaveBeenCalled()
    })

    it('refuses the queue handoff when billing owner validation fails', async () => {
      mockAssertBillingOwner.mockImplementationOnce(() => {
        throw new Error('Billing attribution does not match resource owner')
      })
      queueTableRows(schemaMock.knowledgeConnector, [{ ...CONNECTOR_ROW, workspaceId: 'ws-2' }])

      await expect(
        dispatchMemberSync('c-1', { billingAttribution: BILLING, requestId: 'r-1' })
      ).rejects.toThrow('Billing attribution does not match resource owner')
    })

    /**
     * The guards above the CAS read the row once; a pause or a schedule change
     * that lands after that read is only visible to the CAS itself.
     */
    it('decides the connector status and the schedule inside the queue CAS', async () => {
      const expected = new Date('2026-09-01T06:00:00Z')
      queueTableRows(schemaMock.knowledgeConnector, [
        { ...CONNECTOR_ROW, nextMemberSyncAt: expected },
      ])
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'c-1' }])

      await expect(
        dispatchMemberSync('c-1', {
          billingAttribution: BILLING,
          requestId: 'r-1',
          requireRunnable: true,
          expectedNextMemberSyncAt: expected,
        })
      ).resolves.toEqual({ queued: true })

      expect(vi.mocked(inArray)).toHaveBeenCalledWith(schemaMock.knowledgeConnector.status, [
        'active',
        'error',
      ])
      expect(vi.mocked(eq)).toHaveBeenCalledWith(
        schemaMock.knowledgeConnector.nextMemberSyncAt,
        expected
      )
    })

    it.each([
      [
        'a connector paused after the read',
        { status: 'paused', nextMemberSyncAt: new Date('2026-09-01T06:00:00Z') },
        'Connector is paused and is not synced',
      ],
      [
        'a schedule that moved after the read',
        { status: 'active', nextMemberSyncAt: new Date('2026-09-01T07:00:00Z') },
        'The member sync schedule changed after this run was scheduled',
      ],
    ])('explains a queue entry refused for %s', async (_name, current, reason) => {
      const expected = new Date('2026-09-01T06:00:00Z')
      queueTableRows(schemaMock.knowledgeConnector, [
        { ...CONNECTOR_ROW, nextMemberSyncAt: expected },
      ])
      dbChainMockFns.returning.mockResolvedValueOnce([])
      queueTableRows(schemaMock.knowledgeConnector, [
        {
          accessMode: 'members',
          memberSyncStatus: 'idle',
          syncLockToken: null,
          archivedAt: null,
          deletedAt: null,
          ...current,
        },
      ])

      await expect(
        dispatchMemberSync('c-1', {
          billingAttribution: BILLING,
          requestId: 'r-1',
          requireRunnable: true,
          expectedNextMemberSyncAt: expected,
        })
      ).resolves.toEqual({ queued: false, reason })
      expect(mockTrigger).not.toHaveBeenCalled()
    })
  })

  describe('dispatchMemberSyncsForCredentialOption', () => {
    it('keeps dispatching the remaining connectors when one hand-off throws', async () => {
      mockAssertBillingOwner.mockImplementationOnce(() => {
        throw new Error('Billing attribution does not match resource owner')
      })
      mockResolveSystemBilling.mockResolvedValue(BILLING)
      queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }, { id: 'c-2' }])
      queueTableRows(schemaMock.knowledgeConnector, [{ ...CONNECTOR_ROW, workspaceId: 'ws-2' }])
      queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR_ROW])
      dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'c-2' }])

      await expect(
        dispatchMemberSyncsForCredentialOption({
          workspaceId: 'ws-1',
          credentialGroupOptionId: 'opt-1',
        })
      ).resolves.toBeUndefined()

      expect(mockTrigger).toHaveBeenCalledOnce()
      expect(mockTrigger).toHaveBeenCalledWith(
        MEMBER_SYNC_TASK_ID,
        expect.objectContaining({ connectorId: 'c-2' }),
        expect.any(Object)
      )
    })
  })
})
