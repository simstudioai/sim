import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { databaseMock, drizzleOrmMock } from '@sim/testing/mocks/database.mock'
import { idMock, idMockFns } from '@sim/testing/mocks/id.mock'
import { loggerMock } from '@sim/testing/mocks/logger.mock'
import { schemaMock } from '@sim/testing/mocks/schema.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => databaseMock)
vi.mock('drizzle-orm', () => drizzleOrmMock)
vi.mock('@sim/logger', () => loggerMock)
vi.mock('@sim/utils/id', () => idMock)

import { sleep } from '@sim/utils/helpers'
import {
  AuditAction,
  AuditResourceType,
  recordAudit,
  recordAuditBatch,
  recordAuditOnce,
} from './index'

idMockFns.mockGenerateId.mockReturnValue('test-uuid-123')
idMockFns.mockGenerateShortId.mockReturnValue('test-id-123')

const flush = () => sleep(10)

describe('recordAudit', () => {
  beforeEach(() => {
    resetDbChainMock()
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
    expect(dbChainMockFns.onConflictDoNothing).toHaveBeenCalledWith({
      target: schemaMock.auditLog.id,
    })
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
