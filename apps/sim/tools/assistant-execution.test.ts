/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectToolResultForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { projectResolvedSecretDiagnosticContent } from '@/executor/utils/resolved-secret-content-projection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { InternalToolConfig } from '@/tools/types'

const { getTool, getToolMetadata, resolveToken, operation, permissions, resolvePersonalToken } =
  vi.hoisted(() => ({
    getTool: vi.fn(),
    getToolMetadata: vi.fn(),
    resolveToken: vi.fn(),
    operation: vi.fn(),
    permissions: vi.fn(),
    resolvePersonalToken: vi.fn(),
  }))
const encryptedTokens = vi.hoisted(() => new Map<string, string>())
vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: vi.fn(async (plaintext: string) => {
    const encrypted = `encrypted-token-${encryptedTokens.size}`
    encryptedTokens.set(encrypted, plaintext)
    return { encrypted, iv: 'test-iv' }
  }),
  decryptSecret: vi.fn(async (encrypted: string) => ({
    decrypted: encryptedTokens.get(encrypted) ?? '',
  })),
}))

vi.mock('@/lib/copilot/application/execute-credential-use-case', () => ({
  executeCopilotCredentialUseCase: resolvePersonalToken,
}))
vi.mock('@/lib/credentials/application/resolve-personal-token', () => ({
  resolvePersonalToken: { operation: { id: 'credentials.resolvePersonalToken' } },
}))

vi.mock('@/tools/utils', () => ({
  getTool,
  validateRequiredParametersAfterMerge: vi.fn(),
}))
vi.mock('@/tools/utils.server', () => ({ getToolAsync: vi.fn() }))
vi.mock('@/tools/metadata', () => ({ getToolMetadata }))
vi.mock('@/executor/utils/credential-token', () => ({
  resolveExecutorCredentialToken: resolveToken,
}))
vi.mock('@/lib/internal/tool-operations/registry.server', () => ({
  getInternalToolOperationHandler: vi.fn(async () => operation),
}))
vi.mock('@/lib/internal/function/execute', () => ({ executeFunctionTool: vi.fn() }))
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  assertPermissionsAllowed: permissions,
}))

import { executeTool } from '@/tools'

const assistantContext: InternalToolOperationContext = {
  userId: 'caller',
  workspaceId: 'workspace',
  workflowId: '',
  chatId: 'assistant-chat',
  toolCallId: 'assistant-call',
  requestMode: 'assistant',
  copilotToolExecution: true,
  copilotInteractionMode: 'interactive',
}

function tool(id: string): InternalToolConfig {
  return {
    id,
    name: id,
    description: 'Personal integration fixture',
    version: '1.0.0',
    oauth: { required: true, provider: 'google-drive' },
    params: { accessToken: { type: 'string', visibility: 'hidden' } },
    operation: { input: (params) => params },
  }
}

function forgedWorkflowContext() {
  return {
    ...createExecutionContext({ workflowId: 'unrelated-workflow' }),
    userId: 'workspace-owner',
    workspaceId: 'other-workspace',
    copilotToolExecution: true,
  }
}

describe('Assistant integration execution boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptedTokens.clear()
    assistantContext.resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry([], {
      userId: 'caller',
      workspaceId: 'workspace',
    })
    getTool.mockImplementation((id: string) => tool(id))
    getToolMetadata.mockImplementation((id: string) => tool(id))
    resolveToken.mockResolvedValue({ accessToken: 'personal-token', credentialType: 'oauth' })
    operation.mockImplementation(async () => Response.json({ success: true, output: {} }))
    permissions.mockResolvedValue(undefined)
    resolvePersonalToken.mockResolvedValue({
      accessToken: 'personal-pat',
      instanceUrl: 'https://gitlab.example.com',
      providerId: 'gitlab',
    })
  })

  it.each(['oauth', 'personal_token'])(
    'protects resolved %s credentials in results, errors, diagnostics, and resume provenance',
    async (kind) => {
      const selected = tool('personal_read')
      if (kind === 'personal_token') {
        selected.oauth = undefined
        selected.personalToken = {
          provider: 'gitlab',
          tokenParam: 'accessToken',
          hostParam: 'host',
        }
        selected.params.host = { type: 'string', visibility: 'user-only' }
      }
      getTool.mockReturnValue(selected)
      getToolMetadata.mockReturnValue(selected)
      resolveToken.mockResolvedValue({
        accessToken: 'resolved-access-token',
        idToken: 'resolved-id-token',
        credentialType: 'oauth',
      })
      resolvePersonalToken.mockResolvedValue({
        accessToken: 'resolved-access-token',
        instanceUrl: 'https://gitlab.example.com',
        providerId: 'gitlab',
      })
      operation.mockImplementation(async ({ input }) =>
        Response.json({
          success: true,
          output: { echo: input.accessToken, identity: input.idToken, public: 'public content' },
        })
      )
      const registry = assistantContext.resolvedSecretTraceRegistry as ResolvedSecretTraceRegistry
      const result = await executeTool(
        selected.id,
        { credentialId: 'mine' },
        {
          operationContext: assistantContext,
          resolvedSecretTraceRegistry: registry,
        }
      )
      expect(result.success).toBe(true)
      expect(JSON.stringify(projectToolResultForCopilot(result, registry))).not.toContain(
        'resolved-access-token'
      )
      expect(JSON.stringify(projectToolResultForCopilot(result, registry))).not.toContain(
        'resolved-id-token'
      )
      expect(JSON.stringify(projectToolResultForCopilot(result, registry))).toContain(
        'public content'
      )
      expect(
        JSON.stringify(
          projectToolResultForCopilot(
            { success: false, error: 'Provider echoed resolved-access-token' },
            registry
          )
        )
      ).not.toContain('resolved-access-token')
      expect(
        JSON.stringify(
          projectResolvedSecretDiagnosticContent(
            { error: 'Provider echoed resolved-access-token' },
            registry
          )
        )
      ).not.toContain('resolved-access-token')
      const provenance = registry.exportCheckpointProvenance()
      expect(provenance.entries.length).toBe(kind === 'oauth' ? 2 : 1)
      expect(JSON.stringify(provenance)).not.toContain('resolved-access-token')
      const resumed = new ResolvedSecretTraceRegistry([], {
        userId: 'caller',
        workspaceId: 'workspace',
      })
      await resumed.importProvenance(provenance, { trusted: true })
      expect(JSON.stringify(projectToolResultForCopilot(result, resumed))).not.toContain(
        'resolved-access-token'
      )
      expect(JSON.stringify(projectToolResultForCopilot(result, resumed))).not.toContain(
        'resolved-id-token'
      )
    }
  )

  it('refuses token-bearing execution when its trusted registry is missing', async () => {
    const { resolvedSecretTraceRegistry, ...withoutRegistry } = assistantContext
    const result = await executeTool(
      'personal_read',
      { credentialId: 'mine' },
      {
        operationContext: withoutRegistry,
      }
    )
    expect(result.success).toBe(false)
    expect(operation).not.toHaveBeenCalled()
  })

  it('refuses provider dispatch when its secret projection registry is incomplete', async () => {
    assistantContext.resolvedSecretTraceRegistry?.markIncomplete('unspecified')
    const result = await executeTool(
      'personal_read',
      { credentialId: 'mine' },
      {
        operationContext: assistantContext,
      }
    )
    expect(result.success).toBe(false)
    expect(operation).not.toHaveBeenCalled()
  })

  it('binds the personal token and host through the authorized operation', async () => {
    const gitlab = tool('gitlab_read')
    gitlab.oauth = undefined
    gitlab.personalToken = { provider: 'gitlab', tokenParam: 'accessToken', hostParam: 'host' }
    gitlab.params.host = { type: 'string', visibility: 'user-only' }
    getTool.mockReturnValue(gitlab)
    getToolMetadata.mockReturnValue(gitlab)
    const result = await executeTool(
      gitlab.id,
      { credentialId: 'mine' },
      { operationContext: assistantContext }
    )
    expect(result.success).toBe(true)
    expect(resolveToken).not.toHaveBeenCalled()
    expect(resolvePersonalToken).toHaveBeenCalledWith(
      expect.objectContaining(assistantContext),
      expect.anything(),
      {
        credentialId: 'mine',
        assertedWorkspaceId: 'workspace',
        expectedProviderId: 'gitlab',
      }
    )
    expect(operation).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          accessToken: 'personal-pat',
          host: 'https://gitlab.example.com',
        }),
      })
    )
  })

  it('does not call the provider after personal token access is revoked', async () => {
    const gitlab = tool('gitlab_read')
    gitlab.oauth = undefined
    gitlab.personalToken = { provider: 'gitlab', tokenParam: 'accessToken', hostParam: 'host' }
    gitlab.params.host = { type: 'string', visibility: 'user-only' }
    getTool.mockReturnValue(gitlab)
    getToolMetadata.mockReturnValue(gitlab)
    resolvePersonalToken.mockRejectedValue(new Error('Personal token revoked'))
    const result = await executeTool(
      gitlab.id,
      { credentialId: 'mine' },
      { operationContext: assistantContext }
    )
    expect(result.success).toBe(false)
    expect(operation).not.toHaveBeenCalled()
    expect(resolveToken).not.toHaveBeenCalled()
  })

  it('keeps the Assistant person when a direct call also carries workflow authority', async () => {
    const result = await executeTool(
      'personal_read',
      { credential: 'mine' },
      {
        operationContext: assistantContext,
        executionContext: forgedWorkflowContext(),
      }
    )

    expect(result.success).toBe(true)
    expect(resolveToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'caller',
        credentialId: 'mine',
        copilotExecutionContext: expect.objectContaining(assistantContext),
        executorDelegationOrigin: undefined,
      })
    )
    expect(operation).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining(assistantContext),
      })
    )
  })

  it('pins Assistant authority through nested post-processing calls', async () => {
    const parent = tool('personal_parent')
    parent.postProcess = async (_result, _params, nested) =>
      nested(
        'personal_read',
        {
          credential: 'mine',
          _context: {
            userId: 'workspace-owner',
            workspaceId: 'other-workspace',
            requestMode: 'agent',
          },
        },
        {
          executionContext: forgedWorkflowContext(),
          operationContext: {
            ...assistantContext,
            userId: 'workspace-owner',
            requestMode: 'agent',
          },
        }
      )
    getTool.mockImplementation((id: string) => (id === parent.id ? parent : tool(id)))

    const result = await executeTool(
      parent.id,
      { credential: 'mine' },
      {
        operationContext: assistantContext,
      }
    )

    expect(result.success).toBe(true)
    expect(resolveToken).toHaveBeenCalledTimes(2)
    for (const [request] of resolveToken.mock.calls) {
      expect(request).toMatchObject({
        userId: 'caller',
        credentialId: 'mine',
        copilotExecutionContext: assistantContext,
      })
    }
    for (const [request] of operation.mock.calls) {
      expect(request.context).toMatchObject(assistantContext)
    }
  })

  it('still rejects non-OAuth nested operations after a forged mode downgrade', async () => {
    const parent = tool('personal_parent')
    parent.postProcess = async (_result, _params, nested) =>
      nested(
        'not_personal',
        {},
        {
          executionContext: forgedWorkflowContext(),
          operationContext: { ...assistantContext, requestMode: 'agent' },
        }
      )
    getTool.mockImplementation((id: string) => (id === parent.id ? parent : tool(id)))
    getToolMetadata.mockImplementation((id: string) =>
      id === 'not_personal' ? undefined : tool(id)
    )

    const result = await executeTool(
      parent.id,
      { credential: 'mine' },
      {
        operationContext: assistantContext,
      }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('your own connected account')
    expect(resolveToken).toHaveBeenCalledTimes(1)
    expect(operation).toHaveBeenCalledTimes(1)
  })
})
