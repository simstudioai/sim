/**
 * @vitest-environment node
 */

import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInternalToolFileResult } from '@/lib/internal/tool-operations/file-result'

const mocks = vi.hoisted(() => ({ sendTelegramDocument: vi.fn() }))

vi.mock('@/lib/internal/telegram/operations', () => ({
  sendTelegramDocument: mocks.sendTelegramDocument,
}))

import { executeTelegramTool } from '@/lib/internal/telegram/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const fileResult = createInternalToolFileResult(
  { buffer: Buffer.from('file'), name: 'file.pdf', mimeType: 'application/pdf' },
  (file) => ({ success: true, output: { file } })
)

describe('executeTelegramTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendTelegramDocument.mockResolvedValue(fileResult)
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

    expect(await executeTelegramTool(request)).toBe(fileResult)
    expect(mocks.sendTelegramDocument).toHaveBeenCalledWith(input, {
      userId: 'user-1',
      requestId: 'request-1',
      signal: controller.signal,
    })
  })
})
