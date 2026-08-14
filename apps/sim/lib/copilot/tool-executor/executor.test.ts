/**
 * @vitest-environment node
 */

import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/execution/constants'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const { getToolEntry, isKnownTool, isSimExecuted, isClientExecuted } = vi.hoisted(() => ({
  getToolEntry: vi.fn(),
  isKnownTool: vi.fn(),
  isSimExecuted: vi.fn(),
  isClientExecuted: vi.fn(),
}))

const { executeAppTool } = vi.hoisted(() => ({
  executeAppTool: vi.fn(),
}))

vi.mock('./router', () => ({
  getToolEntry,
  isKnownTool,
  isSimExecuted,
  isClientExecuted,
}))

vi.mock('@/tools', () => ({
  executeTool: executeAppTool,
}))

import { clearHandlers, executeTool, registerHandler } from './executor'

const toolExecutorLogger = vi.mocked(loggerMock.createLogger).mock.results[
  vi.mocked(loggerMock.createLogger).mock.calls.findIndex(([name]) => name === 'ToolExecutor')
]?.value

describe('copilot tool executor fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearHandlers()
    getToolEntry.mockReturnValue(undefined)
  })

  it('enforces catalog-required permissions before dispatch and fails closed when absent', async () => {
    getToolEntry.mockReturnValue({ requiredPermission: 'write' })
    isKnownTool.mockReturnValue(true)
    isSimExecuted.mockReturnValue(true)
    isClientExecuted.mockReturnValue(false)
    const handler = vi.fn().mockResolvedValue({ success: true })
    registerHandler('function_execute', handler)

    await expect(
      executeTool('function_execute', { code: 'return 1' }, { userId: 'user-1', workflowId: '' })
    ).resolves.toEqual({
      success: false,
      error:
        "Permission denied: function_execute requires write access. You have 'none' permission.",
    })
    await expect(
      executeTool(
        'function_execute',
        { code: 'return 1' },
        { userId: 'user-1', workflowId: '', userPermission: 'read' }
      )
    ).resolves.toEqual({
      success: false,
      error:
        "Permission denied: function_execute requires write access. You have 'read' permission.",
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('dispatches catalog-protected tools when the current permission satisfies the requirement', async () => {
    getToolEntry.mockReturnValue({ requiredPermission: 'write' })
    isKnownTool.mockReturnValue(true)
    isSimExecuted.mockReturnValue(true)
    isClientExecuted.mockReturnValue(false)
    const handler = vi.fn().mockResolvedValue({ success: true, output: 'ok' })
    registerHandler('function_execute', handler)

    await expect(
      executeTool(
        'function_execute',
        { code: 'return 1' },
        { userId: 'user-1', workflowId: '', userPermission: 'write' }
      )
    ).resolves.toEqual({ success: true, output: 'ok' })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('rejects a top-level workspaceId outside the trusted workspace before dispatch', async () => {
    isKnownTool.mockReturnValue(true)
    isSimExecuted.mockReturnValue(true)
    isClientExecuted.mockReturnValue(false)
    const handler = vi.fn().mockResolvedValue({ success: true })
    registerHandler('manage_workspace_resource', handler)

    await expect(
      executeTool(
        'manage_workspace_resource',
        { workspaceId: 'ws-2' },
        { userId: 'user-1', workflowId: '', workspaceId: 'ws-1' }
      )
    ).resolves.toEqual({
      success: false,
      error: 'Tool denied: requested workspace does not match the current workspace.',
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects a nested payload workspaceId outside the trusted workspace', async () => {
    isKnownTool.mockReturnValue(true)
    isSimExecuted.mockReturnValue(true)
    isClientExecuted.mockReturnValue(false)
    const handler = vi.fn().mockResolvedValue({ success: true })
    registerHandler('manage_workspace_resource', handler)

    await expect(
      executeTool(
        'manage_workspace_resource',
        { payload: { workspaceId: 'ws-2' } },
        { userId: 'user-1', workflowId: '', workspaceId: 'ws-1' }
      )
    ).resolves.toEqual({
      success: false,
      error: 'Tool denied: requested workspace does not match the current workspace.',
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('preserves workspaceId parameters owned by dynamic integrations', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    isClientExecuted.mockReturnValue(false)
    executeAppTool.mockResolvedValue({ success: true, output: { ok: true } })

    await expect(
      executeTool(
        'external_integration_action',
        { workspaceId: 'external-service-workspace' },
        { userId: 'user-1', workflowId: '', workspaceId: 'ws-1' }
      )
    ).resolves.toEqual({ success: true, output: { ok: true } })
    expect(executeAppTool).toHaveBeenCalledWith(
      'external_integration_action',
      expect.objectContaining({
        workspaceId: 'external-service-workspace',
        _context: expect.objectContaining({ workspaceId: 'ws-1' }),
      })
    )
  })

  it('allows explicit workspaceIds that match the trusted workspace', async () => {
    isKnownTool.mockReturnValue(true)
    isSimExecuted.mockReturnValue(true)
    isClientExecuted.mockReturnValue(false)
    const handler = vi.fn().mockResolvedValue({ success: true })
    registerHandler('manage_workspace_resource', handler)
    const context = { userId: 'user-1', workflowId: '', workspaceId: 'ws-1' }

    await expect(
      executeTool(
        'manage_workspace_resource',
        { workspaceId: 'ws-1', payload: { workspace_id: 'ws-1' } },
        context
      )
    ).resolves.toEqual({ success: true })
    expect(handler).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', payload: { workspace_id: 'ws-1' } },
      context
    )
  })

  it('fails closed to the reviewed local tool set in query-only mode', async () => {
    isKnownTool.mockReturnValue(true)
    isSimExecuted.mockReturnValue(true)
    isClientExecuted.mockReturnValue(false)
    const readHandler = vi.fn().mockResolvedValue({ success: true, output: 'ok' })
    const mutationHandler = vi.fn().mockResolvedValue({ success: true })
    registerHandler('read', readHandler)
    registerHandler('create_workflow', mutationHandler)
    const context = { userId: 'user-1', workflowId: '', queryOnly: true }

    await expect(executeTool('read', { path: 'WORKSPACE.md' }, context)).resolves.toEqual({
      success: true,
      output: 'ok',
    })
    await expect(executeTool('create_workflow', { name: 'Nope' }, context)).resolves.toEqual({
      success: false,
      error: 'Tool denied: create_workflow is not available in query-only mode.',
    })
    expect(readHandler).toHaveBeenCalledOnce()
    expect(mutationHandler).not.toHaveBeenCalled()
  })

  it('denies private credential controls and dynamic integrations when credentialless', async () => {
    isKnownTool.mockImplementation((toolId: string) => toolId !== 'gmail_read')

    for (const toolId of [
      'generate_api_key',
      'list_user_workspaces',
      'manage_credential',
      'oauth_get_auth_link',
      'oauth_request_access',
      'gmail_read',
    ]) {
      await expect(
        executeTool(toolId, {}, { userId: 'user-1', workflowId: '', secretActorUserId: null })
      ).resolves.toEqual({
        success: false,
        error: `Tool denied: ${toolId} is not available without credential access.`,
      })
    }
    expect(executeAppTool).not.toHaveBeenCalled()
  })

  it('keeps workspace environment writes and workflow runs in credentialless mode', async () => {
    isKnownTool.mockReturnValue(true)
    isSimExecuted.mockReturnValue(true)
    isClientExecuted.mockReturnValue(false)
    const envHandler = vi.fn().mockResolvedValue({ success: true })
    const runHandler = vi.fn().mockResolvedValue({ success: true, output: { ran: true } })
    registerHandler('set_environment_variables', envHandler)
    registerHandler('run_workflow', runHandler)
    const context = {
      userId: 'user-1',
      workflowId: 'workflow-1',
      workspaceId: 'ws-1',
      secretActorUserId: null,
    }

    await expect(
      executeTool('set_environment_variables', { scope: 'personal', variables: [] }, context)
    ).resolves.toEqual({
      success: false,
      error:
        'Tool denied: personal environment variables are not available without credential access.',
    })
    await expect(
      executeTool('set_environment_variables', { scope: 'workspace', variables: [] }, context)
    ).resolves.toEqual({ success: true })
    await expect(executeTool('run_workflow', {}, context)).resolves.toEqual({
      success: true,
      output: { ran: true },
    })
    expect(envHandler).toHaveBeenCalledOnce()
    expect(runHandler).toHaveBeenCalledOnce()
  })

  it('keeps workspace custom tools but denies MCP execution in credentialless mode', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    isClientExecuted.mockReturnValue(false)
    executeAppTool.mockResolvedValue({ success: true, output: { ok: true } })
    const context = {
      userId: 'user-1',
      workflowId: 'workflow-1',
      workspaceId: 'ws-1',
      secretActorUserId: null,
    }

    await expect(executeTool('custom_tool-1', {}, context)).resolves.toEqual({
      success: true,
      output: { ok: true },
    })
    await expect(executeTool('mcp-server-1-search', {}, context)).resolves.toEqual({
      success: false,
      error: 'Tool denied: mcp-server-1-search is not available without credential access.',
    })
    expect(executeAppTool).toHaveBeenCalledOnce()
  })

  it('projects resolved secrets before logging registered handler failures', async () => {
    const secret = 'mounted-secret-value'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: secret, encryptedValue: 'encrypted-secret' },
    ])
    registry.recordResolved('API_KEY', secret, { propagated: true })
    isKnownTool.mockReturnValue(true)
    isSimExecuted.mockReturnValue(true)
    isClientExecuted.mockReturnValue(false)
    registerHandler('throwing_tool', async () => {
      throw new Error(`Provider reflected ${secret}`)
    })

    await expect(
      executeTool('throwing_tool', {}, { userId: 'user-1', resolvedSecretTraceRegistry: registry })
    ).resolves.toEqual({ success: false, error: `Provider reflected ${secret}` })

    expect(toolExecutorLogger?.error).toHaveBeenCalledWith('Tool execution failed', {
      toolId: 'throwing_tool',
      error: 'Provider reflected {{API_KEY}}',
      abortSignalAborted: false,
    })
    expect(JSON.stringify(toolExecutorLogger?.error.mock.calls)).not.toContain(secret)
  })

  it('falls back to app tool executor for dynamic sim tools', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    executeAppTool.mockResolvedValue({ success: true, output: { emails: [] } })

    const result = await executeTool(
      'gmail_read',
      { maxResults: 10, credentialId: 'cred-123' },
      { userId: 'user-1', workflowId: 'workflow-1', workspaceId: 'ws-1', chatId: 'chat-1' }
    )

    expect(executeAppTool).toHaveBeenCalledWith(
      'gmail_read',
      expect.objectContaining({
        maxResults: 10,
        credentialId: 'cred-123',
        credential: 'cred-123',
        _context: expect.objectContaining({
          userId: 'user-1',
          workflowId: 'workflow-1',
          workspaceId: 'ws-1',
          chatId: 'chat-1',
          enforceCredentialAccess: true,
        }),
      }),
      {
        internalExecutorDelegation: {
          subjectUserId: 'user-1',
          workflowId: 'workflow-1',
        },
      }
    )
    expect(result).toEqual({ success: true, output: { emails: [] } })
  })

  it('forwards the active cancellation signal to dynamic app tools', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    executeAppTool.mockResolvedValue({ success: true, output: {} })
    const controller = new AbortController()

    await executeTool(
      'gmail_read',
      {},
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        abortSignal: controller.signal,
      }
    )

    expect(executeAppTool).toHaveBeenCalledWith(
      'gmail_read',
      expect.any(Object),
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it('threads billing attribution into _context for dynamic tools (MCP)', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    executeAppTool.mockResolvedValue({ success: true, output: {} })

    const billingAttribution = {
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
      organizationId: null,
      billedAccountUserId: 'owner-1',
      billingEntity: { type: 'user', id: 'owner-1' },
      billingPeriod: { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
      payerSubscription: null,
    }

    await executeTool(
      'mcp-server-1-web_search_exa',
      { query: 'test' },
      {
        userId: 'user-1',
        workflowId: '',
        workspaceId: 'ws-1',
        billingAttribution: billingAttribution as never,
      }
    )

    expect(executeAppTool).toHaveBeenCalledWith(
      'mcp-server-1-web_search_exa',
      expect.objectContaining({
        _context: expect.objectContaining({
          userId: 'user-1',
          workspaceId: 'ws-1',
          billingAttribution,
        }),
      })
    )
  })

  it('omits billingAttribution from _context when the context has none', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    executeAppTool.mockResolvedValue({ success: true, output: {} })

    await executeTool('gmail_read', {}, { userId: 'user-1', workflowId: 'workflow-1' })

    const appParams = executeAppTool.mock.calls[0][1] as Record<string, unknown>
    expect(appParams._context).not.toHaveProperty('billingAttribution')
  })

  it('passes trace provenance out-of-band without exposing it in app tool parameters', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    executeAppTool.mockResolvedValue({ success: true, output: { result: 'unchanged' } })
    const registry = {} as ResolvedSecretTraceRegistry

    const result = await executeTool(
      'gmail_read',
      { query: 'hello' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(executeAppTool).toHaveBeenCalledWith(
      'gmail_read',
      expect.objectContaining({
        query: 'hello',
        _context: expect.not.objectContaining({ resolvedSecretTraceRegistry: expect.anything() }),
      }),
      {
        resolvedSecretTraceRegistry: registry,
        internalExecutorDelegation: {
          subjectUserId: 'user-1',
          workflowId: 'workflow-1',
        },
      }
    )
    const appParams = executeAppTool.mock.calls[0]?.[1]
    expect(JSON.stringify(appParams)).not.toContain('resolvedSecretTraceRegistry')
    expect(result).toEqual({ success: true, output: { result: 'unchanged' } })
  })

  it('uses the registered handler for client-routed tools when running headless (Mothership block)', async () => {
    isKnownTool.mockReturnValue(true)
    isSimExecuted.mockReturnValue(false)
    isClientExecuted.mockReturnValue(true)

    const runWorkflowHandler = vi.fn().mockResolvedValue({ success: true, output: { ran: true } })
    registerHandler('run_workflow', runWorkflowHandler)

    const context = { userId: 'user-1', workflowId: 'workflow-1', workspaceId: 'ws-1' }
    const result = await executeTool('run_workflow', { workflow_input: {} }, context)

    expect(runWorkflowHandler).toHaveBeenCalledWith({ workflow_input: {} }, context)
    expect(executeAppTool).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, output: { ran: true } })
  })

  it('falls back to app tool executor for client-routed tools with no registered handler', async () => {
    isKnownTool.mockReturnValue(true)
    isSimExecuted.mockReturnValue(false)
    isClientExecuted.mockReturnValue(true)
    executeAppTool.mockResolvedValue({
      success: false,
      error: 'Tool not found: unknown_client_tool',
    })

    await executeTool('unknown_client_tool', {}, { userId: 'user-1' })

    expect(executeAppTool).toHaveBeenCalledWith('unknown_client_tool', expect.any(Object))
  })

  it('converts function_execute timeout from seconds to milliseconds for copilot calls', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    executeAppTool.mockResolvedValue({ success: true, output: { result: 'ok' } })

    await executeTool(
      'function_execute',
      { code: 'return 1', timeout: 7 },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'ws-1',
        copilotToolExecution: true,
      }
    )

    expect(executeAppTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({
        timeout: 7000,
        _context: expect.objectContaining({
          copilotToolExecution: true,
        }),
      }),
      {
        internalExecutorDelegation: {
          subjectUserId: 'user-1',
          workflowId: 'workflow-1',
        },
      }
    )
  })

  it('converts function_execute timeout before invoking its registered Sim handler', async () => {
    isKnownTool.mockReturnValue(true)
    isSimExecuted.mockReturnValue(true)
    isClientExecuted.mockReturnValue(false)
    const handler = vi.fn().mockResolvedValue({ success: true, output: { result: 'ok' } })
    registerHandler('function_execute', handler)

    const context = {
      userId: 'user-1',
      workflowId: 'workflow-1',
      workspaceId: 'ws-1',
      copilotToolExecution: true,
    }
    await executeTool('function_execute', { code: 'return 1', timeout: 7 }, context)

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'return 1',
        timeout: 7000,
      }),
      context
    )
    expect(executeAppTool).not.toHaveBeenCalled()
  })

  it('defaults copilot function_execute timeout to 10 seconds when omitted', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    executeAppTool.mockResolvedValue({ success: true, output: { result: 'ok' } })

    await executeTool(
      'function_execute',
      { code: 'return 1' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'ws-1',
        copilotToolExecution: true,
      }
    )

    expect(executeAppTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({
        timeout: 10_000,
      }),
      {
        internalExecutorDelegation: {
          subjectUserId: 'user-1',
          workflowId: 'workflow-1',
        },
      }
    )
  })

  it('defaults copilot function_execute timeout to 10 seconds when invalid', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    executeAppTool.mockResolvedValue({ success: true, output: { result: 'ok' } })

    await executeTool(
      'function_execute',
      { code: 'return 1', timeout: 0 },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'ws-1',
        copilotToolExecution: true,
      }
    )

    expect(executeAppTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({
        timeout: 10_000,
      }),
      {
        internalExecutorDelegation: {
          subjectUserId: 'user-1',
          workflowId: 'workflow-1',
        },
      }
    )
  })

  it('does not let copilot function_execute timeout exceed the default execution limit', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    executeAppTool.mockResolvedValue({ success: true, output: { result: 'ok' } })

    await executeTool(
      'function_execute',
      { code: 'return 1', timeout: 10_000 },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'ws-1',
        copilotToolExecution: true,
      }
    )

    expect(executeAppTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({
        timeout: DEFAULT_EXECUTION_TIMEOUT_MS,
      }),
      {
        internalExecutorDelegation: {
          subjectUserId: 'user-1',
          workflowId: 'workflow-1',
        },
      }
    )
  })
})
