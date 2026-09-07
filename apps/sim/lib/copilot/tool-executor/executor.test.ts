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

const { executeAppTool, recordSecretUsage } = vi.hoisted(() => ({
  executeAppTool: vi.fn(),
  recordSecretUsage: vi.fn(),
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

vi.mock('@/lib/secrets/usage/record', () => ({ recordSecretUsage }))

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

  it.each(['run_workflow', 'read', 'manage_knowledge_base', 'mcp_remote_tool', 'unknown_tool'])(
    'refuses %s in Assistant even for an admin and forged handler',
    async (toolId) => {
      isKnownTool.mockReturnValue(true)
      isSimExecuted.mockReturnValue(true)
      const handler = vi.fn()
      registerHandler(toolId, handler)
      const result = await executeTool(
        toolId,
        {},
        {
          userId: 'person',
          workspaceId: 'workspace',
          workflowId: '',
          userPermission: 'admin',
          requestMode: 'assistant',
        }
      )
      expect(result.success).toBe(false)
      expect(handler).not.toHaveBeenCalled()
      expect(executeAppTool).not.toHaveBeenCalled()
    }
  )

  it.each(['search_workspace', 'read_document'])(
    'dispatches %s with explicit org context for canonical organization authorization',
    async (toolId) => {
      getToolEntry.mockReturnValue({ requiredPermission: 'read' })
      isKnownTool.mockReturnValue(true)
      isSimExecuted.mockReturnValue(true)
      isClientExecuted.mockReturnValue(false)
      const handler = vi.fn().mockResolvedValue({ success: true })
      registerHandler(toolId, handler)
      const context = {
        userId: 'user-1',
        organizationId: 'org-1',
        requestMode: 'assistant' as const,
      }
      expect((await executeTool(toolId, {}, context)).success).toBe(true)
      expect(handler).toHaveBeenCalledWith({}, expect.objectContaining({ organizationId: 'org-1' }))
    }
  )

  it.each([
    ['run_workflow', undefined],
    ['gmail_send', undefined],
    ['search_workspace', 'workspace-1'],
  ])('refuses organization authority for %s in workspace %s', async (toolId, workspaceId) => {
    const handler = vi.fn()
    registerHandler(toolId, handler)
    expect(
      (await executeTool(toolId, {}, { userId: 'user-1', organizationId: 'org-1', workspaceId }))
        .success
    ).toBe(false)
    expect(handler).not.toHaveBeenCalled()
    expect(executeAppTool).not.toHaveBeenCalled()
  })

  it('enforces catalog-required permissions before dispatch and fails closed when absent', async () => {
    getToolEntry.mockReturnValue({ requiredPermission: 'write' })
    isKnownTool.mockReturnValue(true)
    isSimExecuted.mockReturnValue(true)
    isClientExecuted.mockReturnValue(false)
    const handler = vi.fn().mockResolvedValue({ success: true })
    registerHandler('run_function', handler)

    await expect(
      executeTool('run_function', { code: 'return 1' }, { userId: 'user-1', workflowId: '' })
    ).resolves.toEqual({
      success: false,
      error: "Permission denied: run_function requires write access. You have 'none' permission.",
    })
    await expect(
      executeTool(
        'run_function',
        { code: 'return 1' },
        { userId: 'user-1', workflowId: '', userPermission: 'read' }
      )
    ).resolves.toEqual({
      success: false,
      error: "Permission denied: run_function requires write access. You have 'read' permission.",
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('dispatches catalog-protected tools when the current permission satisfies the requirement', async () => {
    getToolEntry.mockReturnValue({ requiredPermission: 'write' })
    isKnownTool.mockReturnValue(true)
    isSimExecuted.mockReturnValue(true)
    isClientExecuted.mockReturnValue(false)
    const handler = vi.fn().mockResolvedValue({ success: true, output: 'ok' })
    registerHandler('run_function', handler)

    await expect(
      executeTool(
        'run_function',
        { code: 'return 1' },
        { userId: 'user-1', workflowId: '', userPermission: 'write' }
      )
    ).resolves.toEqual({ success: true, output: 'ok' })
    expect(handler).toHaveBeenCalledOnce()
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
      expect.objectContaining({
        operationContext: expect.objectContaining({
          userId: 'user-1',
          workflowId: 'workflow-1',
          workspaceId: 'ws-1',
        }),
      })
    )
    expect(result).toEqual({ success: true, output: { emails: [] } })
  })

  it('forwards trusted authority and cancellation to dynamic custom tools', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    executeAppTool.mockResolvedValue({ success: true, output: { result: 'custom output' } })
    const abortController = new AbortController()

    const result = await executeTool(
      'custom_weather-tool',
      {
        location: 'San Francisco',
        _context: { userId: 'attacker', workspaceId: 'evil-workspace' },
      },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'ws-1',
        executionId: 'execution-1',
        abortSignal: abortController.signal,
      }
    )

    expect(executeAppTool).toHaveBeenCalledWith(
      'custom_weather-tool',
      expect.objectContaining({
        location: 'San Francisco',
        _context: expect.objectContaining({
          userId: 'user-1',
          workspaceId: 'ws-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        }),
      }),
      expect.objectContaining({
        signal: abortController.signal,
        operationContext: expect.objectContaining({
          userId: 'user-1',
          workspaceId: 'ws-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        }),
      })
    )
    expect(result).toEqual({ success: true, output: { result: 'custom output' } })
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
      }),
      expect.objectContaining({
        operationContext: expect.objectContaining({
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
      expect.objectContaining({
        resolvedSecretTraceRegistry: registry,
        operationContext: expect.objectContaining({
          userId: 'user-1',
          workflowId: 'workflow-1',
          resolvedSecretTraceRegistry: registry,
        }),
      })
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

    const context = {
      userId: 'user-1',
      workflowId: 'workflow-1',
      workspaceId: 'ws-1',
      userPermission: 'write',
    }
    const result = await executeTool('run_workflow', { workflow_input: {} }, context)

    expect(runWorkflowHandler).toHaveBeenCalledWith({ workflow_input: {} }, context)
    expect(executeAppTool).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, output: { ran: true } })
  })

  /**
   * `run_workflow` carries no catalog permission — the browser path authorizes it through the
   * workflow APIs against the caller's own session. The headless fallback has no session, so
   * without a bar of its own a deliberately capped run (an unattributed inbox message) would
   * still execute workflows under the principal it was capped away from.
   */
  it.each([['read'], [undefined]] as const)(
    'refuses the headless client fallback for a %s permission',
    async (userPermission) => {
      isKnownTool.mockReturnValue(true)
      isSimExecuted.mockReturnValue(false)
      isClientExecuted.mockReturnValue(true)

      const runWorkflowHandler = vi.fn().mockResolvedValue({ success: true })
      registerHandler('run_workflow', runWorkflowHandler)

      const result = await executeTool(
        'run_workflow',
        { workflow_input: {} },
        { userId: 'user-1', workflowId: 'workflow-1', workspaceId: 'ws-1', userPermission }
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('requires write access')
      expect(runWorkflowHandler).not.toHaveBeenCalled()
      expect(executeAppTool).not.toHaveBeenCalled()
    }
  )

  it('falls back to app tool executor for client-routed tools with no registered handler', async () => {
    isKnownTool.mockReturnValue(true)
    isSimExecuted.mockReturnValue(false)
    isClientExecuted.mockReturnValue(true)
    executeAppTool.mockResolvedValue({
      success: false,
      error: 'Tool not found: unknown_client_tool',
    })

    await executeTool('unknown_client_tool', {}, { userId: 'user-1' })

    expect(executeAppTool).toHaveBeenCalledWith(
      'unknown_client_tool',
      expect.any(Object),
      expect.objectContaining({ operationContext: expect.any(Object) })
    )
  })

  it('converts run_function timeout from seconds to milliseconds for copilot calls', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    executeAppTool.mockResolvedValue({ success: true, output: { result: 'ok' } })

    await executeTool(
      'run_function',
      { code: 'return 1', timeout: 7 },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'ws-1',
        copilotToolExecution: true,
      }
    )

    expect(executeAppTool).toHaveBeenCalledWith(
      'run_function',
      expect.objectContaining({
        timeout: 7000,
        _context: expect.objectContaining({
          copilotToolExecution: true,
        }),
      }),
      expect.objectContaining({
        operationContext: expect.objectContaining({
          userId: 'user-1',
          workflowId: 'workflow-1',
          workspaceId: 'ws-1',
          copilotToolExecution: true,
        }),
      })
    )
  })

  it('converts run_function timeout before invoking its registered Sim handler', async () => {
    isKnownTool.mockReturnValue(true)
    isSimExecuted.mockReturnValue(true)
    isClientExecuted.mockReturnValue(false)
    const handler = vi.fn().mockResolvedValue({ success: true, output: { result: 'ok' } })
    registerHandler('run_function', handler)

    const context = {
      userId: 'user-1',
      workflowId: 'workflow-1',
      workspaceId: 'ws-1',
      copilotToolExecution: true,
    }
    await executeTool('run_function', { code: 'return 1', timeout: 7 }, context)

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'return 1',
        timeout: 7000,
      }),
      context
    )
    expect(executeAppTool).not.toHaveBeenCalled()
  })

  it('defaults copilot run_function timeout to 10 seconds when omitted', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    executeAppTool.mockResolvedValue({ success: true, output: { result: 'ok' } })

    await executeTool(
      'run_function',
      { code: 'return 1' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'ws-1',
        copilotToolExecution: true,
      }
    )

    expect(executeAppTool).toHaveBeenCalledWith(
      'run_function',
      expect.objectContaining({
        timeout: 10_000,
      }),
      expect.objectContaining({
        operationContext: expect.objectContaining({
          userId: 'user-1',
          workflowId: 'workflow-1',
          workspaceId: 'ws-1',
          copilotToolExecution: true,
        }),
      })
    )
  })

  it('defaults copilot run_function timeout to 10 seconds when invalid', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    executeAppTool.mockResolvedValue({ success: true, output: { result: 'ok' } })

    await executeTool(
      'run_function',
      { code: 'return 1', timeout: 0 },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'ws-1',
        copilotToolExecution: true,
      }
    )

    expect(executeAppTool).toHaveBeenCalledWith(
      'run_function',
      expect.objectContaining({
        timeout: 10_000,
      }),
      expect.objectContaining({
        operationContext: expect.objectContaining({
          userId: 'user-1',
          workflowId: 'workflow-1',
          workspaceId: 'ws-1',
          copilotToolExecution: true,
        }),
      })
    )
  })

  it('does not let copilot run_function timeout exceed the default execution limit', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    executeAppTool.mockResolvedValue({ success: true, output: { result: 'ok' } })

    await executeTool(
      'run_function',
      { code: 'return 1', timeout: 10_000 },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'ws-1',
        copilotToolExecution: true,
      }
    )

    expect(executeAppTool).toHaveBeenCalledWith(
      'run_function',
      expect.objectContaining({
        timeout: DEFAULT_EXECUTION_TIMEOUT_MS,
      }),
      expect.objectContaining({
        operationContext: expect.objectContaining({
          userId: 'user-1',
          workflowId: 'workflow-1',
          workspaceId: 'ws-1',
          copilotToolExecution: true,
        }),
      })
    )
  })

  /**
   * An integration tool resolves `{{SECRET}}` into its user-only params, which is a real use
   * of a workspace secret. This is the branch that carries it — a gateway call Go resolves to
   * `slack_send` is not in the copilot catalog, so it lands here rather than on a handler.
   */
  it('records the secrets an integration tool call resolved', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'SLACK_TOKEN', plaintext: 'xoxb-value', encryptedValue: 'enc', scope: 'workspace' },
    ])
    registry.recordResolved('SLACK_TOKEN', 'xoxb-value')
    executeAppTool.mockResolvedValue({ success: true })

    await executeTool(
      'slack_send',
      { token: '{{SLACK_TOKEN}}' },
      {
        userId: 'user-1',
        workflowId: '',
        workspaceId: 'ws-1',
        copilotToolExecution: true,
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(recordSecretUsage).toHaveBeenCalledWith(
      [{ name: 'SLACK_TOKEN', scope: 'workspace', ownerUserId: null }],
      {
        workspaceId: 'ws-1',
        source: 'copilot',
        actorUserId: 'user-1',
        trigger: 'copilot',
      }
    )
  })

  /** A failed call still resolved the secret, so the trail must not lose it. */
  it('records usage even when the integration tool throws', async () => {
    isKnownTool.mockReturnValue(false)
    isSimExecuted.mockReturnValue(false)
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'SLACK_TOKEN', plaintext: 'xoxb-value', encryptedValue: 'enc', scope: 'workspace' },
    ])
    registry.recordResolved('SLACK_TOKEN', 'xoxb-value')
    executeAppTool.mockRejectedValue(new Error('provider rejected the call'))

    await expect(
      executeTool(
        'slack_send',
        {},
        {
          userId: 'user-1',
          workflowId: '',
          workspaceId: 'ws-1',
          resolvedSecretTraceRegistry: registry,
        }
      )
    ).rejects.toThrow('provider rejected the call')

    expect(recordSecretUsage).toHaveBeenCalledTimes(1)
  })

  /**
   * `function_execute` records its own mounted secrets in the copilot handler. If it also
   * recorded here, every Sim agent code run would count each secret twice.
   */
  it('does not record from the handler branch, which owns its own accounting', async () => {
    isKnownTool.mockReturnValue(true)
    isSimExecuted.mockReturnValue(true)
    isClientExecuted.mockReturnValue(false)
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: 'a-value', encryptedValue: 'enc', scope: 'workspace' },
    ])
    registry.recordResolved('API_KEY', 'a-value')
    registerHandler('function_execute', async () => ({ success: true }))

    await executeTool(
      'function_execute',
      { code: 'return 1' },
      {
        userId: 'user-1',
        workflowId: '',
        workspaceId: 'ws-1',
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(recordSecretUsage).not.toHaveBeenCalled()
  })
})
