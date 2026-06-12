/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/execution/constants'

const { isKnownTool, isSimExecuted, isClientExecuted } = vi.hoisted(() => ({
  isKnownTool: vi.fn(),
  isSimExecuted: vi.fn(),
  isClientExecuted: vi.fn(),
}))

const { executeAppTool } = vi.hoisted(() => ({
  executeAppTool: vi.fn(),
}))

vi.mock('./router', () => ({
  isKnownTool,
  isSimExecuted,
  isClientExecuted,
}))

vi.mock('@/tools', () => ({
  executeTool: executeAppTool,
}))

import { clearHandlers, executeTool, registerHandler } from './executor'

describe('copilot tool executor fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearHandlers()
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
      })
    )
    expect(result).toEqual({ success: true, output: { emails: [] } })
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
      })
    )
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
      })
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
      })
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
      })
    )
  })
})
