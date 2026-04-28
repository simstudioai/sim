/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

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
})
