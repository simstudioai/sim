/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'

const mocks = vi.hoisted(() => ({
  createPrincipal: vi.fn(),
  executeManage: vi.fn(),
  executeParser: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
}))

vi.mock('@/lib/internal/file/operations', () => ({
  executeFileManageOperation: mocks.executeManage,
}))

vi.mock('@/lib/internal/file/parser', () => ({
  executeFileParserOperation: mocks.executeParser,
}))

import { executeFileTool } from '@/lib/internal/file/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'

const MANAGE_INPUTS = {
  file_append: { operation: 'append', fileName: 'notes.txt', content: 'next' },
  file_compress: { operation: 'compress', fileId: 'file-1' },
  file_decompress: { operation: 'decompress', fileId: 'file-1' },
  file_get: { operation: 'get', fileId: 'file-1' },
  file_get_content: { operation: 'content', fileId: 'file-1' },
  file_manage_sharing: { operation: 'manage_sharing', fileId: 'file-1', isActive: false },
  file_read: { operation: 'read', fileId: 'file-1' },
  file_write: { operation: 'write', fileName: 'notes.txt', content: 'hello' },
} as const

const PARSER_TOOL_IDS = ['file_fetch', 'file_parser', 'file_parser_v2', 'file_parser_v3'] as const

const BILLING_ATTRIBUTION = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'user', id: 'workspace-owner' },
  billingPeriod: {
    start: '2026-08-01T00:00:00.000Z',
    end: '2026-09-01T00:00:00.000Z',
  },
  payerSubscription: null,
} satisfies BillingAttributionSnapshot

function request(
  toolId: string,
  input: unknown,
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId,
    input,
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      executionId: 'execution-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      billingAttribution: BILLING_ATTRIBUTION,
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeFileTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createPrincipal.mockResolvedValue({
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    mocks.executeManage.mockResolvedValue(Response.json({ success: true }))
    mocks.executeParser.mockResolvedValue(Response.json({ success: true }))
  })

  it.each(Object.entries(MANAGE_INPUTS))('validates and dispatches %s', async (toolId, input) => {
    const response = await executeFileTool(request(toolId, input))

    expect(response.status).toBe(200)
    expect(mocks.executeManage).toHaveBeenCalledWith(
      expect.objectContaining(input),
      expect.objectContaining({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        requestId: 'request-1',
      })
    )
    expect(mocks.executeParser).not.toHaveBeenCalled()
  })

  it.each(PARSER_TOOL_IDS)('dispatches %s with trusted execution scope', async (toolId) => {
    const response = await executeFileTool(
      request(toolId, { filePath: 'https://example.com/report.txt', fileType: '' })
    )

    expect(response.status).toBe(200)
    expect(mocks.executeParser).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: 'https://example.com/report.txt' }),
      expect.objectContaining({
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        userId: 'user-1',
      })
    )
    expect(mocks.executeManage).not.toHaveBeenCalled()
  })

  it('constructs the executor principal from trusted context', async () => {
    const executionRequest = request('file_get', MANAGE_INPUTS.file_get)

    await executeFileTool(executionRequest)

    expect(mocks.createPrincipal).toHaveBeenCalledWith({
      context: executionRequest.context,
      audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
    })
  })

  it('uses the delegation origin as the file authorization subject in child workflows', async () => {
    mocks.createPrincipal.mockResolvedValueOnce({
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: 'invoking-user',
      workspaceId: 'workspace-1',
    })
    await executeFileTool(
      request('file_get', MANAGE_INPUTS.file_get, {
        context: {
          ...createExecutionContext({ workflowId: 'workflow-child' }),
          executionId: 'execution-child',
          userId: 'workflow-owner',
          workspaceId: 'workspace-1',
          executorDelegationOrigin: {
            subjectUserId: 'invoking-user',
            workflowId: 'workflow-parent',
            executionId: 'execution-parent',
          },
        },
      })
    )

    expect(mocks.executeManage).toHaveBeenCalledWith(
      expect.objectContaining(MANAGE_INPUTS.file_get),
      expect.objectContaining({ userId: 'invoking-user' })
    )
  })

  it('uses compatibility attribution without replacing an actorless deployed principal', async () => {
    const principal = {
      kind: 'delegated' as const,
      serviceId: 'executor' as const,
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      delegationContext: {
        kind: 'workflow_execution' as const,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        principal: {
          kind: 'system' as const,
          serviceId: 'schedule' as const,
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
        },
        currentWorkflow: {
          workflowId: 'workflow-1',
          mode: 'deployment' as const,
          deploymentVersionId: 'deployment-1',
        },
      },
    }
    mocks.createPrincipal.mockResolvedValueOnce(principal)

    await executeFileTool(
      request('file_decompress', MANAGE_INPUTS.file_decompress, {
        context: {
          ...createExecutionContext({ workflowId: 'workflow-1' }),
          executionId: 'execution-1',
          userId: 'legacy-actor',
          workspaceId: 'workspace-1',
          billingAttribution: BILLING_ATTRIBUTION,
          executorDelegationOrigin: {
            workflowId: 'workflow-1',
            executionId: 'execution-1',
            principal: principal.delegationContext.principal,
            currentWorkflow: principal.delegationContext.currentWorkflow,
          },
        },
      })
    )

    expect(mocks.executeManage).toHaveBeenCalledWith(
      expect.objectContaining(MANAGE_INPUTS.file_decompress),
      expect.objectContaining({
        principal,
        userId: 'workspace-owner',
        workspaceId: 'workspace-1',
      })
    )
  })

  it('rejects missing trusted identity during principal construction', async () => {
    mocks.createPrincipal.mockRejectedValueOnce(new Error('Authentication required'))
    const response = await executeFileTool(
      request('file_get', MANAGE_INPUTS.file_get, {
        context: {
          ...createExecutionContext({ workflowId: 'workflow-1' }),
          workspaceId: 'workspace-1',
          userId: undefined,
          executorDelegationOrigin: undefined,
        },
      })
    )

    expect(response.status).toBe(401)
    expect(mocks.createPrincipal).toHaveBeenCalledOnce()
    expect(mocks.executeManage).not.toHaveBeenCalled()
  })

  it('returns canonical validation errors before operation work', async () => {
    const response = await executeFileTool(request('file_write', { operation: 'write' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(mocks.executeManage).not.toHaveBeenCalled()
  })

  it('propagates cancellation before principal or operation work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeFileTool(request('file_get', MANAGE_INPUTS.file_get, { signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.createPrincipal).not.toHaveBeenCalled()
    expect(mocks.executeManage).not.toHaveBeenCalled()
  })

  it('propagates cancellation that arrives while operation work is running', async () => {
    const controller = new AbortController()
    mocks.executeManage.mockImplementationOnce(async () => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      return Response.json({ success: true })
    })

    await expect(
      executeFileTool(request('file_get', MANAGE_INPUTS.file_get, { signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
