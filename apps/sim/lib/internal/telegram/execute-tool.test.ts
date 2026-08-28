/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ sendTelegramDocument: vi.fn() }))

vi.mock('@/lib/internal/telegram/operations', () => ({
  sendTelegramDocument: mocks.sendTelegramDocument,
}))

import { executeTelegramTool } from '@/lib/internal/telegram/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

describe('executeTelegramTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendTelegramDocument.mockResolvedValue({ success: true, output: {} })
  })

  it('uses trusted user context for protected files', async () => {
    const controller = new AbortController()
    const input = {
      botToken: 'token',
      chatId: 'chat-1',
      files: [{ key: 'workspace/file.pdf', name: 'file.pdf', size: 3 }],
    }
    const request: InternalToolOperationCall = {
      toolId: 'telegram_send_document',
      input,
      headers: new Headers(),
      context: { ...createExecutionContext(), userId: 'user-1' },
      requestId: 'request-1',
      signal: controller.signal,
    }

    expect((await executeTelegramTool(request)).status).toBe(200)
    expect(mocks.sendTelegramDocument).toHaveBeenCalledWith(input, {
      userId: 'user-1',
      requestId: 'request-1',
      signal: controller.signal,
    })
  })
})
