/**
 * @vitest-environment node
 */
import {
  auditMock,
  dbChainMock,
  dbChainMockFns,
  requestUtilsMockFns,
  resetDbChainMock,
} from '@sim/testing'
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
vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))
vi.mock('@sim/utils/id', () => ({
  generateId: () => 'test-uuid-123',
  generateShortId: () => 'test-id-123',
  isValidUuid: (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
}))

import { AuditAction, AuditResourceType, recordAudit } from './index'

const flush = () => new Promise((resolve) => setTimeout(resolve, 10))

describe('AuditAction', () => {
  it('contains all expected action categories', () => {
    expect(AuditAction.WORKFLOW_CREATED).toBe('workflow.created')
    expect(AuditAction.MEMBER_INVITED).toBe('member.invited')
    expect(AuditAction.API_KEY_CREATED).toBe('api_key.created')
    expect(AuditAction.ORGANIZATION_CREATED).toBe('organization.created')
  })

  it('has unique values for every key', () => {
    const values = Object.values(AuditAction)
    const unique = new Set(values)
    expect(unique.size).toBe(values.length)
  })
})

describe('AuditResourceType', () => {
  it('contains all expected resource types', () => {
    expect(AuditResourceType.WORKFLOW).toBe('workflow')
    expect(AuditResourceType.WORKSPACE).toBe('workspace')
    expect(AuditResourceType.API_KEY).toBe('api_key')
    expect(AuditResourceType.MCP_SERVER).toBe('mcp_server')
  })

  it('has unique values for every key', () => {
    const values = Object.values(AuditResourceType)
    const unique = new Set(values)
    expect(unique.size).toBe(values.length)
  })
})

describe('recordAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    requestUtilsMockFns.mockGetClientIp.mockImplementation(
      (request: { headers: { get(name: string): string | null } }) =>
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip')?.trim() ||
        'unknown'
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('inserts an audit log entry with all required fields', async () => {
    recordAudit({
      workspaceId: 'ws-1',
      actorId: 'user-1',
      actorName: 'Test User',
      actorEmail: 'test@example.com',
      action: AuditAction.WORKFLOW_CREATED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: 'wf-1',
    })

    await flush()

    expect(dbChainMockFns.insert).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'test-id-123',
        workspaceId: 'ws-1',
        actorId: 'user-1',
        action: 'workflow.created',
        resourceType: 'workflow',
        resourceId: 'wf-1',
        metadata: {},
      })
    )
  })

  it('includes optional denormalized fields when provided', async () => {
    recordAudit({
      workspaceId: 'ws-1',
      actorId: 'user-1',
      action: AuditAction.FOLDER_CREATED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: 'folder-1',
      actorName: 'Waleed',
      actorEmail: 'waleed@example.com',
      resourceName: 'My Folder',
      description: 'Created folder "My Folder"',
    })

    await flush()

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        actorName: 'Waleed',
        actorEmail: 'waleed@example.com',
        resourceName: 'My Folder',
        description: 'Created folder "My Folder"',
      })
    )
  })

  it('extracts IP address from x-forwarded-for header', async () => {
    const request = new Request('https://example.com', {
      headers: {
        'x-forwarded-for': '1.2.3.4, 5.6.7.8',
        'user-agent': 'TestAgent/1.0',
      },
    })

    recordAudit({
      workspaceId: 'ws-1',
      actorId: 'user-1',
      actorName: 'Test',
      actorEmail: 'test@test.com',
      action: AuditAction.MEMBER_INVITED,
      resourceType: AuditResourceType.WORKSPACE,
      request,
    })

    await flush()

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        ipAddress: '1.2.3.4',
        userAgent: 'TestAgent/1.0',
      })
    )
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', async () => {
    const request = new Request('https://example.com', {
      headers: { 'x-real-ip': '10.0.0.1' },
    })

    recordAudit({
      workspaceId: 'ws-1',
      actorId: 'user-1',
      actorName: 'Test',
      actorEmail: 'test@test.com',
      action: AuditAction.API_KEY_CREATED,
      resourceType: AuditResourceType.API_KEY,
      request,
    })

    await flush()

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        ipAddress: '10.0.0.1',
        userAgent: undefined,
      })
    )
  })

  it('defaults metadata to empty object when not provided', async () => {
    recordAudit({
      workspaceId: 'ws-1',
      actorId: 'user-1',
      actorName: 'Test',
      actorEmail: 'test@test.com',
      action: AuditAction.ENVIRONMENT_UPDATED,
      resourceType: AuditResourceType.ENVIRONMENT,
    })

    await flush()

    expect(dbChainMockFns.values).toHaveBeenCalledWith(expect.objectContaining({ metadata: {} }))
  })

  it('passes through metadata when provided', async () => {
    recordAudit({
      workspaceId: 'ws-1',
      actorId: 'user-1',
      actorName: 'Test',
      actorEmail: 'test@test.com',
      action: AuditAction.WEBHOOK_CREATED,
      resourceType: AuditResourceType.WEBHOOK,
      metadata: { provider: 'github', workflowId: 'wf-1' },
    })

    await flush()

    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { provider: 'github', workflowId: 'wf-1' },
      })
    )
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

  it('does not block — returns void synchronously', () => {
    const result = recordAudit({
      workspaceId: 'ws-1',
      actorId: 'user-1',
      actorName: 'Test',
      actorEmail: 'test@test.com',
      action: AuditAction.CHAT_DEPLOYED,
      resourceType: AuditResourceType.CHAT,
    })

    expect(result).toBeUndefined()
  })

  describe('lazy actor resolution', () => {
    it('looks up user when actorName and actorEmail are both undefined', async () => {
      dbChainMockFns.limit.mockResolvedValue([
        { name: 'Resolved Name', email: 'resolved@example.com' },
      ])

      recordAudit({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        action: AuditAction.DOCUMENT_UPLOADED,
        resourceType: AuditResourceType.DOCUMENT,
        resourceId: 'doc-1',
      })

      await flush()

      expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
      expect(dbChainMockFns.values).toHaveBeenCalledWith(
        expect.objectContaining({
          actorName: 'Resolved Name',
          actorEmail: 'resolved@example.com',
        })
      )
    })

    it('skips lookup when actorName is provided (even if null)', async () => {
      recordAudit({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        actorName: null,
        actorEmail: null,
        action: AuditAction.DOCUMENT_UPLOADED,
        resourceType: AuditResourceType.DOCUMENT,
      })

      await flush()

      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    })

    it('skips lookup when actorName and actorEmail are provided', async () => {
      recordAudit({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        actorName: 'Already Known',
        actorEmail: 'known@example.com',
        action: AuditAction.WORKFLOW_CREATED,
        resourceType: AuditResourceType.WORKFLOW,
      })

      await flush()

      expect(dbChainMockFns.select).not.toHaveBeenCalled()
      expect(dbChainMockFns.values).toHaveBeenCalledWith(
        expect.objectContaining({
          actorName: 'Already Known',
          actorEmail: 'known@example.com',
        })
      )
    })

    it('inserts without actor info when lookup fails', async () => {
      dbChainMockFns.limit.mockRejectedValue(new Error('DB down'))

      recordAudit({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        action: AuditAction.KNOWLEDGE_BASE_CREATED,
        resourceType: AuditResourceType.KNOWLEDGE_BASE,
      })

      await flush()

      expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
      expect(dbChainMockFns.values).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          actorName: undefined,
          actorEmail: undefined,
        })
      )
    })

    it('sets actor info to null when user is not found', async () => {
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
          actorId: 'deleted-user',
          actorName: undefined,
          actorEmail: undefined,
        })
      )
    })
  })
})

describe('auditMock sync', () => {
  it('has the same AuditAction keys as the source', () => {
    const sourceKeys = Object.keys(AuditAction).sort()
    const mockKeys = Object.keys(auditMock.AuditAction).sort()
    expect(mockKeys).toEqual(sourceKeys)
  })

  it('has the same AuditAction values as the source', () => {
    const mockActions = auditMock.AuditAction as Record<string, string>
    for (const key of Object.keys(AuditAction)) {
      expect(mockActions[key]).toBe(AuditAction[key as keyof typeof AuditAction])
    }
  })

  it('has the same AuditResourceType keys as the source', () => {
    const sourceKeys = Object.keys(AuditResourceType).sort()
    const mockKeys = Object.keys(auditMock.AuditResourceType).sort()
    expect(mockKeys).toEqual(sourceKeys)
  })

  it('has the same AuditResourceType values as the source', () => {
    const mockResourceTypes = auditMock.AuditResourceType as Record<string, string>
    for (const key of Object.keys(AuditResourceType)) {
      expect(mockResourceTypes[key]).toBe(AuditResourceType[key as keyof typeof AuditResourceType])
    }
  })
})
