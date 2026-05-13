/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/execution/constants'

const { isKnownTool, isSimExecuted } = vi.hoisted(() => ({
  isKnownTool: vi.fn(),
  isSimExecuted: vi.fn(),
}))

const { executeAppTool } = vi.hoisted(() => ({
  executeAppTool: vi.fn(),
}))

vi.mock('./router', () => ({
  isKnownTool,
  isSimExecuted,
}))

vi.mock('@/tools', () => ({
  executeTool: executeAppTool,
}))

import { executeTool } from './executor'

describe('copilot tool executor fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      false
    )
    expect(result).toEqual({ success: true, output: { emails: [] } })
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
      false
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
      }),
      false
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
      false
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
      false
    )
  })
})
