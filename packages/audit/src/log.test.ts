import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({
  ...dbChainMock,
  auditLog: { id: 'id', workspaceId: 'workspace_id' },
  user: { id: 'id', name: 'name', email: 'email' },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  sql: vi.fn(),
}))
const { mockGetRequestContext } = vi.hoisted(() => ({
  mockGetRequestContext: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  getRequestContext: mockGetRequestContext,
}))
vi.mock('@sim/utils/id', () => ({
  generateId: () => 'test-uuid-123',
  generateShortId: () => 'test-id-123',
  isValidUuid: (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
}))

import { sleep } from '@sim/utils/helpers'
import {
  AuditAction,
  AuditResourceType,
  recordAudit,
  recordAuditBatch,
  recordAuditOnce,
} from './index'

const flush = () => sleep(10)

describe('recordAudit', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('awaits an idempotent audit insert under the caller-owned ID', async () => {
    await recordAuditOnce('admin-refund:operation-1', {
      actorId: 'user-1',
      actorName: 'Test User',
      actorEmail: 'test@example.com',
      action: AuditAction.SUBSCRIPTION_REFUNDED,
      resourceType: AuditResourceType.SUBSCRIPTION,
      resourceId: 'subscription-1',
    })

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'admin-refund:operation-1',
        action: 'subscription.refunded',
        resourceId: 'subscription-1',
      })
    )
    expect(dbChainMockFns.onConflictDoNothing).toHaveBeenCalledWith({ target: 'id' })
  })

  it('does not throw when the database insert fails', async () => {
    dbChainMockFns.values.mockImplementation(() => Promise.reject(new Error('DB connection lost')))

    expect(() => {
      recordAudit({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        actorName: 'Test',
        actorEmail: 'test@test.com',
        action: AuditAction.WORKFLOW_DELETED,
        resourceType: AuditResourceType.WORKFLOW,
      })
    }).not.toThrow()

    await flush()
  })

  describe('lazy actor resolution', () => {
    it('nulls the actor FK when the lookup throws so the insert cannot FK-violate', async () => {
      dbChainMockFns.limit.mockRejectedValue(new Error('DB down'))

      recordAudit({
        workspaceId: 'ws-1',
        actorId: 'admin-api',
        action: AuditAction.KNOWLEDGE_BASE_CREATED,
        resourceType: AuditResourceType.KNOWLEDGE_BASE,
      })

      await flush()

      expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
      expect(dbChainMockFns.values).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: null,
          actorName: 'Admin API',
          actorEmail: undefined,
        })
      )
    })

    it('nulls the actor FK and labels it System when the user is not found', async () => {
      dbChainMockFns.limit.mockResolvedValue([])

      recordAudit({
        workspaceId: 'ws-1',
        actorId: 'deleted-user',
        action: AuditAction.WORKFLOW_DELETED,
        resourceType: AuditResourceType.WORKFLOW,
      })

      await flush()

      expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
      expect(dbChainMockFns.values).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: null,
          actorName: 'System',
          actorEmail: undefined,
        })
      )
    })
  })
})

describe('recordAuditBatch', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('does not throw when the batch insert fails', async () => {
    dbChainMockFns.values.mockImplementation(() => Promise.reject(new Error('DB connection lost')))

    expect(() => {
      recordAuditBatch([
        {
          workspaceId: 'ws-1',
          actorId: null,
          actorName: 'Billing System',
          action: AuditAction.WORKSPACE_UPDATED,
          resourceType: AuditResourceType.WORKSPACE,
        },
      ])
    }).not.toThrow()

    await flush()
  })
})
