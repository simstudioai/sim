/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveFiles: vi.fn(),
  secureFetchWithPinnedIP: vi.fn(),
  secureFetchWithValidation: vi.fn(),
  validateUrlWithDNS: vi.fn(),
}))

vi.mock('@/lib/internal/slack/file-input', () => ({
  forEachSlackAttachmentFile: mocks.resolveFiles,
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mocks.secureFetchWithPinnedIP,
  secureFetchWithValidation: mocks.secureFetchWithValidation,
  validateUrlWithDNS: mocks.validateUrlWithDNS,
}))

import type { SlackOperationError } from '@/lib/internal/slack/errors'
import {
  executeSlackAddReaction,
  executeSlackDownload,
  executeSlackReadMessages,
  executeSlackSendMessage,
  executeSlackUpdateMessage,
} from '@/lib/internal/slack/operations'
import { executeSlackGetChannelHistoryOperation } from '@/lib/internal/slack/operations/get-channel-history'
import { executeSlackGetThreadRepliesOperation } from '@/lib/internal/slack/operations/get-thread-replies'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

const originalFetch = global.fetch

function slackResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

describe('Slack operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn() as unknown as typeof fetch
    mocks.validateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '93.184.216.34',
      originalHostname: 'files.slack.com',
    })
    mocks.secureFetchWithValidation.mockResolvedValue(new Response(null, { status: 200 }))
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('passes cancellation through Slack Web API calls and preserves logical-error status', async () => {
    const controller = new AbortController()
    vi.mocked(global.fetch).mockResolvedValueOnce(
      slackResponse({ ok: false, error: 'already_reacted' })
    )

    await expect(
      executeSlackAddReaction(
        { accessToken: 'token', channel: 'C1', timestamp: '1.0', name: 'eyes' },
        controller.signal
      )
    ).rejects.toMatchObject<Partial<SlackOperationError>>({
      status: 200,
      body: { success: false, error: 'already_reacted' },
    })
    expect(vi.mocked(global.fetch).mock.calls[0]?.[1]).toMatchObject({
      signal: controller.signal,
    })
  })

  it('retains the update fallback message and exact metadata projection', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      slackResponse({ ok: true, channel: 'C1', ts: '2.0', text: 'normalized' })
    )

    const result = await executeSlackUpdateMessage({
      accessToken: 'token',
      channel: 'C1',
      timestamp: '1.0',
      text: 'updated',
    })

    expect(result).toEqual({
      success: true,
      output: {
        message: {
          type: 'message',
          ts: '2.0',
          text: 'normalized',
          channel: 'C1',
        },
        content: 'Message updated successfully',
        metadata: { channel: 'C1', timestamp: '2.0', text: 'normalized' },
      },
    })
  })

  it('opens a DM, keeps the read limit bounded by the contract, and maps legacy fields', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(slackResponse({ ok: true, channel: { id: 'D1' } }))
      .mockResolvedValueOnce(
        slackResponse({
          ok: true,
          messages: [
            {
              ts: '2.0',
              text: 'hello',
              reactions: [{ name: 'eyes', count: 1 }],
              files: [{ id: 'F1', name: 'report.pdf' }],
              edited: { user: 'U2', ts: '2.1' },
            },
          ],
        })
      )

    const result = await executeSlackReadMessages({
      accessToken: 'token',
      userId: 'U1',
      limit: 15,
    })

    expect(result.output.messages).toHaveLength(1)
    expect(result.output.messages[0]).toMatchObject({
      type: 'message',
      ts: '2.0',
      reactions: [{ name: 'eyes', count: 1, users: [] }],
      files: [{ id: 'F1', name: 'report.pdf' }],
      edited: { user: 'U2', ts: '2.1' },
    })
    const historyUrl = String(vi.mocked(global.fetch).mock.calls[1]?.[0])
    expect(historyUrl).toContain('channel=D1')
    expect(historyUrl).toContain('limit=15')
  })

  it('uses the protected file resolver, validated upload URL, and completes sharing', async () => {
    const controller = new AbortController()
    mocks.resolveFiles.mockImplementation(async (_files, _context, consume) => {
      await consume({
        buffer: Buffer.from('hello'),
        contentType: 'text/plain',
        name: 'hello.txt',
        type: 'text/plain',
      })
    })
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        slackResponse({
          ok: true,
          upload_url: 'https://files.slack.com/upload/signed',
          file_id: 'F1',
        })
      )
      .mockResolvedValueOnce(
        slackResponse({
          ok: true,
          files: [{ id: 'F1', name: 'hello.txt', created: 10, mimetype: 'text/plain' }],
        })
      )

    const result = await executeSlackSendMessage(
      {
        accessToken: 'token',
        channel: 'C1',
        text: 'hello',
        files: [{ key: 'workspace/file-1', name: 'hello.txt', size: 5 }],
      },
      {
        requestId: 'request-1',
        signal: controller.signal,
        userId: 'user-1',
      }
    )

    expect(mocks.resolveFiles).toHaveBeenCalledWith(
      [{ key: 'workspace/file-1', name: 'hello.txt', size: 5 }],
      expect.objectContaining({
        requestId: 'request-1',
        signal: controller.signal,
        userId: 'user-1',
      }),
      expect.any(Function)
    )
    expect(mocks.secureFetchWithValidation).toHaveBeenCalledWith(
      'https://files.slack.com/upload/signed',
      expect.objectContaining({
        method: 'POST',
        body: Buffer.from('hello'),
        signal: controller.signal,
      }),
      'uploadUrl'
    )
    expect(result.output).toMatchObject({
      channel: 'C1',
      fileCount: 1,
      ts: '10',
      files: [{ name: 'hello.txt', size: 5 }],
    })
  })

  it('keeps private Slack downloads DNS-pinned, bounded, and cancellable', async () => {
    const controller = new AbortController()
    vi.mocked(global.fetch).mockResolvedValueOnce(
      slackResponse({
        ok: true,
        file: {
          name: 'report.pdf',
          mimetype: 'application/pdf',
          url_private: 'https://files.slack.com/report.pdf',
        },
      })
    )
    mocks.secureFetchWithPinnedIP.mockResolvedValue(
      new Response(Buffer.from('pdf'), { status: 200 })
    )

    const result = await executeSlackDownload(
      { accessToken: 'token', fileId: 'F1' },
      controller.signal
    )

    expect(mocks.secureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://files.slack.com/report.pdf',
      '93.184.216.34',
      {
        headers: { Authorization: 'Bearer token' },
        maxResponseBytes: MAX_FILE_SIZE,
        signal: controller.signal,
      }
    )
    expect(result.output.file).toEqual({
      name: 'report.pdf',
      mimeType: 'application/pdf',
      data: Buffer.from('pdf').toString('base64'),
      size: 3,
    })
  })

  it.each([
    ['channel history', executeSlackGetChannelHistoryOperation, { channel: 'C1' }],
    ['thread replies', executeSlackGetThreadRepliesOperation, { channel: 'C1', threadTs: '1.0' }],
  ] as const)('passes cancellation through paginated %s reads', async (_name, operation, input) => {
    const controller = new AbortController()
    vi.mocked(global.fetch).mockResolvedValueOnce(
      slackResponse({ ok: true, messages: [], response_metadata: { next_cursor: '' } })
    )

    await operation({ accessToken: 'token', ...input } as never, controller.signal)

    expect(vi.mocked(global.fetch).mock.calls[0]?.[1]).toMatchObject({
      signal: controller.signal,
    })
  })

  it('interrupts a paginated Slack rate-limit wait when cancelled', async () => {
    const controller = new AbortController()
    vi.mocked(global.fetch).mockResolvedValueOnce(
      slackResponse({ ok: false, error: 'ratelimited' }, 429)
    )

    const result = executeSlackGetChannelHistoryOperation(
      { accessToken: 'token', channel: 'C1' },
      controller.signal
    )
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await rejection
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})
