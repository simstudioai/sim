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
  searchContent: vi.fn(),
  getProvenance: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
}))

vi.mock('@/lib/internal/file/operations', () => ({
  executeFileManageOperation: mocks.executeManage,
  getFileContentProvenance: mocks.getProvenance,
  fileContentJsonResponse: (
    body: Record<string, unknown>,
    includePrivateProvenance: boolean,
    init?: ResponseInit,
    provenance?: Record<string, unknown>
  ) =>
    Response.json(
      includePrivateProvenance ? { ...body, __resolvedSecretTraceProvenance: provenance } : body,
      init
    ),
}))

vi.mock('@/lib/internal/file/parser', () => ({
  executeFileParserOperation: mocks.executeParser,
}))

vi.mock('@/lib/workspace-files/application/search-workspace-file-content', () => ({
  searchWorkspaceFileContent: { execute: mocks.searchContent },
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

const SEARCH_RESULT = {
  results: [{ fileId: 'file-1', lineNumber: 2, text: 'needle' }],
  count: 1,
  truncated: false,
  complete: true,
  indexStatus: {
    readyFiles: 1,
    pendingFiles: 0,
    failedFiles: 0,
    skippedFiles: 0,
    partialFiles: 0,
  },
  sources: [
    {
      identity: { fileId: 'file-1', key: 'workspace/workspace-1/file.txt' },
      ownerUserId: 'user-1',
    },
  ],
}

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
      executorDelegationOrigin: {
        subjectUserId: 'user-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        currentWorkflow: { workflowId: 'workflow-1', mode: 'draft' },
      },
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
    mocks.searchContent.mockResolvedValue(SEARCH_RESULT)
    mocks.getProvenance.mockResolvedValue({ version: 1, complete: true, entries: [] })
  })

  it('searches with the trusted workspace and delegated executor principal', async () => {
    const response = await executeFileTool(
      request('file_search', { query: 'needle', maxResults: 25 })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        results: [{ fileId: 'file-1', lineNumber: 2, text: 'needle' }],
        count: 1,
      },
    })
    expect(mocks.searchContent).toHaveBeenCalledWith({
      principal: expect.objectContaining({ serviceId: 'executor' }),
      input: { workspaceId: 'workspace-1', query: 'needle', maxResults: 25, signal: undefined },
    })
    expect(mocks.executeManage).not.toHaveBeenCalled()
  })

  it('uses the default search cap and aggregates provenance for every matched file', async () => {
    const response = await executeFileTool(
      request(
        'file_search',
        { query: 'needle' },
        {
          headers: new Headers({
            'x-sim-request-private-tool-metadata': 'resolved-secret-provenance-v1',
          }),
        }
      )
    )

    expect(mocks.searchContent).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { workspaceId: 'workspace-1', query: 'needle', maxResults: 50 },
      })
    )
    expect(mocks.getProvenance).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: 'executor' }),
      'workspace-1',
      expect.arrayContaining([
        expect.objectContaining({
          identity: expect.objectContaining({ fileId: 'file-1' }),
        }),
      ]),
      undefined
    )
    const body = await response.json()
    expect(body.data.sources).toBeUndefined()
    expect(body.__resolvedSecretTraceProvenance).toMatchObject({ complete: true })
  })

  it.each([
    [{ query: 'ab', maxResults: 50 }, 400],
    [{ query: 'needle', maxResults: 201 }, 400],
    [{ query: 'needle', maxResults: 0 }, 400],
  ])('rejects invalid search input before authorization', async (input, status) => {
    const response = await executeFileTool(request('file_search', input))

    expect(response.status).toBe(status)
    expect(mocks.createPrincipal).not.toHaveBeenCalled()
    expect(mocks.searchContent).not.toHaveBeenCalled()
  })

  it('does not expose unexpected search infrastructure errors', async () => {
    mocks.searchContent.mockRejectedValueOnce(new Error('database host and query details'))

    const response = await executeFileTool(request('file_search', { query: 'needle' }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Failed to search workspace files',
    })
  })

  it('propagates cancellation that arrives while search work is running', async () => {
    const controller = new AbortController()
    mocks.searchContent.mockImplementationOnce(async () => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      return SEARCH_RESULT
    })

    await expect(
      executeFileTool(request('file_search', { query: 'needle' }, { signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.searchContent).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ signal: controller.signal }),
      })
    )
    expect(mocks.getProvenance).not.toHaveBeenCalled()
  })

  it('propagates cancellation that arrives while search provenance is loading', async () => {
    const controller = new AbortController()
    mocks.getProvenance.mockImplementationOnce(async () => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      return { version: 1, complete: true, entries: [] }
    })

    await expect(
      executeFileTool(
        request(
          'file_search',
          { query: 'needle' },
          {
            signal: controller.signal,
            headers: new Headers({
              'x-sim-request-private-tool-metadata': 'resolved-secret-provenance-v1',
            }),
          }
        )
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each(Object.entries(MANAGE_INPUTS))('validates and dispatches %s', async (toolId, input) => {
    const response = await executeFileTool(request(toolId, input))

    expect(response.status).toBe(200)
    expect(mocks.executeManage).toHaveBeenCalledWith(
      expect.objectContaining(input),
      expect.objectContaining({
        workspaceId: 'workspace-1',
        attributedUserId: 'user-1',
        fileAccessUserId: 'user-1',
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
        attributedUserId: 'user-1',
        fileAccessUserId: 'user-1',
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
      expect.objectContaining({
        attributedUserId: 'invoking-user',
        fileAccessUserId: 'invoking-user',
      })
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
        compatibilityActor: {
          kind: 'legacy_execution_user' as const,
          userId: 'legacy-actor',
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
        attributedUserId: 'workspace-owner',
        fileAccessUserId: undefined,
        workspaceId: 'workspace-1',
      })
    )
  })

  it('rejects missing trusted identity during principal construction', async () => {
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
    expect(mocks.createPrincipal).not.toHaveBeenCalled()
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
