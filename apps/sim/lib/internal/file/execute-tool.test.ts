import type { PersonalApiKeyPrincipal } from '@sim/auth/principal'
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InvalidInternalDelegationBindingError } from '@/lib/auth/internal-delegation'
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

  it.each([undefined, 'user-1'])(
    'does not derive authority from body fields or userId (%s)',
    async (userId) => {
      const response = await executeFileTool(
        request(
          'file_read',
          {
            operation: 'read',
            fileId: 'file-1',
            callerPrincipal: { kind: 'session', userId: 'user-1', sessionId: 'forged' },
          },
          {
            context: { workflowId: '', workspaceId: 'workspace-1', userId },
          }
        )
      )
      expect(response.status).toBe(401)
      expect(mocks.createPrincipal).not.toHaveBeenCalled()
      expect(mocks.executeManage).not.toHaveBeenCalled()
    }
  )

  it('keeps executor delegation authoritative when a direct caller is also present', async () => {
    const callerPrincipal: PersonalApiKeyPrincipal = {
      kind: 'personal_api_key',
      userId: 'user-1',
      keyId: 'key-1',
    }
    const call = request('file_read', MANAGE_INPUTS.file_read)
    call.context.callerPrincipal = callerPrincipal
    const response = await executeFileTool(call)
    expect(response.status).toBe(200)
    expect(mocks.createPrincipal).toHaveBeenCalled()
    expect(mocks.executeManage.mock.calls[0]?.[1].principal).toMatchObject({
      kind: 'delegated',
      serviceId: 'executor',
    })
    expect(mocks.executeManage.mock.calls[0]?.[1].principal).not.toBe(callerPrincipal)
  })

  it('never falls back to a direct caller after invalid executor delegation', async () => {
    const call = request('file_read', MANAGE_INPUTS.file_read)
    call.context.callerPrincipal = { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' }
    mocks.createPrincipal.mockRejectedValueOnce(new InvalidInternalDelegationBindingError())
    const response = await executeFileTool(call)
    expect(response.status).toBe(401)
    expect(mocks.createPrincipal).toHaveBeenCalled()
    expect(mocks.executeManage).not.toHaveBeenCalled()
  })

  it('rejects a direct caller without trusted workspace scope', async () => {
    const response = await executeFileTool(
      request('file_read', MANAGE_INPUTS.file_read, {
        context: {
          workflowId: '',
          callerPrincipal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
        },
      })
    )
    expect(response.status).toBe(401)
    expect(mocks.executeManage).not.toHaveBeenCalled()
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
})
