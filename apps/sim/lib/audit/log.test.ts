/**
 * @vitest-environment node
 */
import { databaseMock, loggerMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({
  ...databaseMock,
  auditLog: { id: 'id', workspaceId: 'workspace_id' },
}))
vi.mock('@sim/logger', () => loggerMock)
vi.mock('nanoid', () => ({ nanoid: () => 'test-id-123' }))

import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'

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
  const mockInsert = databaseMock.db.insert
  let mockValues: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockValues = vi.fn(() => Promise.resolve())
    mockInsert.mockReturnValue({ values: mockValues })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('inserts an audit log entry with all required fields', async () => {
    recordAudit({
      workspaceId: 'ws-1',
      actorId: 'user-1',
      action: AuditAction.WORKFLOW_CREATED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: 'wf-1',
    })

    await vi.waitFor(() => {
      expect(mockInsert).toHaveBeenCalledTimes(1)
    })

    expect(mockValues).toHaveBeenCalledWith(
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

    await vi.waitFor(() => {
      expect(mockValues).toHaveBeenCalledTimes(1)
    })

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        actorName: 'Waleed',
        actorEmail: 'waleed@example.com',
        resourceName: 'My Folder',
        description: 'Created folder "My Folder"',
      })
    )
  })

  it('sets optional fields to undefined when not provided', async () => {
    recordAudit({
      workspaceId: 'ws-1',
      actorId: 'user-1',
      action: AuditAction.WORKSPACE_DELETED,
      resourceType: AuditResourceType.WORKSPACE,
    })

    await vi.waitFor(() => {
      expect(mockValues).toHaveBeenCalledTimes(1)
    })

    const insertedValues = mockValues.mock.calls[0][0]
    expect(insertedValues.resourceId).toBeUndefined()
    expect(insertedValues.actorName).toBeUndefined()
    expect(insertedValues.actorEmail).toBeUndefined()
    expect(insertedValues.resourceName).toBeUndefined()
    expect(insertedValues.description).toBeUndefined()
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
      action: AuditAction.MEMBER_INVITED,
      resourceType: AuditResourceType.WORKSPACE,
      request,
    })

    await vi.waitFor(() => {
      expect(mockValues).toHaveBeenCalledTimes(1)
    })

    expect(mockValues).toHaveBeenCalledWith(
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
      action: AuditAction.API_KEY_CREATED,
      resourceType: AuditResourceType.API_KEY,
      request,
    })

    await vi.waitFor(() => {
      expect(mockValues).toHaveBeenCalledTimes(1)
    })

    expect(mockValues).toHaveBeenCalledWith(
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
      action: AuditAction.ENVIRONMENT_UPDATED,
      resourceType: AuditResourceType.ENVIRONMENT,
    })

    await vi.waitFor(() => {
      expect(mockValues).toHaveBeenCalledTimes(1)
    })

    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({ metadata: {} }))
  })

  it('passes through metadata when provided', async () => {
    recordAudit({
      workspaceId: 'ws-1',
      actorId: 'user-1',
      action: AuditAction.WEBHOOK_CREATED,
      resourceType: AuditResourceType.WEBHOOK,
      metadata: { provider: 'github', workflowId: 'wf-1' },
    })

    await vi.waitFor(() => {
      expect(mockValues).toHaveBeenCalledTimes(1)
    })

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { provider: 'github', workflowId: 'wf-1' },
      })
    )
  })

  it('does not throw when the database insert fails', async () => {
    mockValues.mockReturnValue(Promise.reject(new Error('DB connection lost')))

    expect(() => {
      recordAudit({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        action: AuditAction.WORKFLOW_DELETED,
        resourceType: AuditResourceType.WORKFLOW,
      })
    }).not.toThrow()
  })

  it('does not block — returns void synchronously', () => {
    const result = recordAudit({
      workspaceId: 'ws-1',
      actorId: 'user-1',
      action: AuditAction.CHAT_DEPLOYED,
      resourceType: AuditResourceType.CHAT,
    })

    expect(result).toBeUndefined()
  })
})
