import {
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
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
vi.mock('@/lib/core/config/trigger-availability', () => ({
  isTriggerAvailable: mockIsTriggerAvailable,
}))
vi.mock('@trigger.dev/sdk', () => ({
  tasks: { trigger: mockTrigger },
  idempotencyKeys: { create: vi.fn(async (key: string) => key) },
}))
vi.mock('@/lib/core/async-jobs/region', () => ({ resolveTriggerRegion: mockResolveRegion }))

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
    resetEnvFlagsMock()
    resetDbChainMock()
    mockIsTriggerAvailable.mockReturnValue(true)
    mockResolveRegion.mockResolvedValue('us')
    mockExecuteMemberSync.mockResolvedValue({})
  })

  it('does not dispatch a live Search source to member indexing', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    queueTableRows(schemaMock.knowledgeConnector, [{ ...CONNECTOR_ROW, isSearchIndex: true }])
    expect(await dispatchMemberSync('c-1', { billingAttribution: BILLING })).toEqual({
      queued: false,
      reason: 'This source is searched live and does not require indexing.',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockTrigger).not.toHaveBeenCalled()
    expect(mockExecuteMemberSync).not.toHaveBeenCalled()
  })

  describe('assertMemberSyncPayload', () => {
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
    it('does not reset account backoff when its retry cannot claim the connector', async () => {
      queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR_ROW])
      queueTableRows(schemaMock.knowledgeConnector, [{ ...CONNECTOR_ROW, status: 'paused' }])
      dbChainMockFns.returning.mockResolvedValueOnce([])
      await expect(
        dispatchMemberSync('c-1', {
          billingAttribution: BILLING,
          connectedCredentialId: 'reconnected-account',
        })
      ).resolves.toMatchObject({ queued: false })
      expect(dbChainMockFns.update).not.toHaveBeenCalledWith(schemaMock.knowledgeConnectorMember)
      expect(mockTrigger).not.toHaveBeenCalled()
    })

    it('rejects a rapid manual repeat without making members due', async () => {
      queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR_ROW])
      queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR_ROW])
      queueTableRows(schemaMock.knowledgeConnectorMemberSyncLog, [
        { status: 'completed', completedAt: new Date(), failures: 0 },
      ])
      await expect(
        dispatchMemberSync('c-1', { billingAttribution: BILLING, manual: true })
      ).rejects.toMatchObject({ code: 'conflict' })
      expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      expect(mockTrigger).not.toHaveBeenCalled()
      expect(mockExecuteMemberSync).not.toHaveBeenCalled()
    })

    it('does not reschedule members if a concurrent lifecycle change declines the claim', async () => {
      queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR_ROW])
      queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR_ROW])
      queueTableRows(schemaMock.knowledgeConnectorMemberSyncLog, [])
      queueTableRows(schemaMock.knowledgeConnector, [{ ...CONNECTOR_ROW, status: 'paused' }])
      dbChainMockFns.returning.mockResolvedValueOnce([])
      await expect(
        dispatchMemberSync('c-1', { billingAttribution: BILLING, manual: true })
      ).resolves.toMatchObject({ queued: false })
      expect(dbChainMockFns.update).not.toHaveBeenCalledWith(schemaMock.knowledgeConnectorMember)
      expect(mockTrigger).not.toHaveBeenCalled()
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

    it('refuses the queue handoff when billing owner validation fails', async () => {
      mockAssertBillingOwner.mockImplementationOnce(() => {
        throw new Error('Billing attribution does not match resource owner')
      })
      queueTableRows(schemaMock.knowledgeConnector, [{ ...CONNECTOR_ROW, workspaceId: 'ws-2' }])

      await expect(
        dispatchMemberSync('c-1', { billingAttribution: BILLING, requestId: 'r-1' })
      ).rejects.toThrow('Billing attribution does not match resource owner')
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
