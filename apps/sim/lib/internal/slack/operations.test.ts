import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'
import { isInternalToolFileResult } from '@/lib/internal/tool-operations/file-result'

const mocks = vi.hoisted(() => ({
  resolveFiles: vi.fn(),
  uploadExecution: vi.fn(),
  secureFetchWithPinnedIP: vi.fn(),
  secureFetchWithValidation: vi.fn(),
  validateUrlWithDNS: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/execution', () => ({ uploadExecutionFile: mocks.uploadExecution }))
vi.mock('@/lib/uploads/contexts/copilot', () => ({ uploadCopilotFile: vi.fn() }))

vi.mock('@/lib/internal/slack/file-input', () => ({
  forEachSlackAttachmentFile: mocks.resolveFiles,
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mocks.secureFetchWithPinnedIP,
  secureFetchWithValidation: mocks.secureFetchWithValidation,
  validateUrlWithDNS: mocks.validateUrlWithDNS,
}))

import {
  slackSendEphemeralBodySchema,
  slackSendMessageBodySchema,
  slackUpdateMessageBodySchema,
} from '@/lib/api/contracts/tools/communication/slack'
import { projectToolOutputs } from '@/lib/catalog/projection/tool'
import {
  executeSlackDownload,
  executeSlackSendEphemeral,
  executeSlackSendMessage,
  executeSlackUpdateMessage,
} from '@/lib/internal/slack/operations'
import { presentInternalToolOperationResult } from '@/lib/internal/tool-operations/file-result.server'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import type { UserFile } from '@/executor/types'
import { slackDownloadTool } from '@/tools/slack/download'
import { slackEphemeralMessageTool } from '@/tools/slack/ephemeral_message'
import { slackMessageTool } from '@/tools/slack/message'
import { slackScheduleMessageTool } from '@/tools/slack/schedule_message'
import { slackUpdateMessageTool } from '@/tools/slack/update_message'

const originalFetch = global.fetch

function slackResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

describe('Slack operations', () => {
  beforeEach(() => {
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

  describe.each(['send', 'ephemeral', 'update'] as const)('%s Block Kit payload', (operation) => {
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: '*Ready*' } }]
    const params = {
      accessToken: 'token',
      channel: 'C1',
      user: 'U1',
      timestamp: '1.0',
      blocks: JSON.stringify(blocks),
    }

    async function execute(text?: string) {
      const input = { ...params, text }
      if (operation === 'send') {
        const parsed = slackSendMessageBodySchema.parse(slackMessageTool.operation.input(input))
        return executeSlackSendMessage(parsed, { userId: 'user-1', requestId: 'request-1' })
      }
      if (operation === 'ephemeral') {
        const parsed = slackSendEphemeralBodySchema.parse(
          slackEphemeralMessageTool.operation.input(input)
        )
        return executeSlackSendEphemeral(parsed)
      }
      const parsed = slackUpdateMessageBodySchema.parse(
        slackUpdateMessageTool.operation.input(input)
      )
      return executeSlackUpdateMessage(parsed)
    }

    it('sends explicit text alongside blocks unchanged for notifications and accessibility', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        slackResponse({ ok: true, channel: 'C1', ts: '1.0', message_ts: '1.0' })
      )
      await execute('Deployment is ready.\nReview the release notes.')
      const [url, request] = vi.mocked(global.fetch).mock.calls[0]!
      expect(String(url)).toBe(
        `https://slack.com/api/${{ send: 'chat.postMessage', ephemeral: 'chat.postEphemeral', update: 'chat.update' }[operation]}`
      )
      expect(JSON.parse(String(request?.body))).toMatchObject({
        channel: 'C1',
        text: 'Deployment is ready.\nReview the release notes.',
        blocks,
      })
    })

    it.each([undefined, '', ' \n '])(
      'omits absent or blank fallback %j instead of inserting whitespace',
      async (text) => {
        vi.mocked(global.fetch).mockResolvedValueOnce(
          slackResponse({ ok: true, channel: 'C1', ts: '1.0', message_ts: '1.0' })
        )
        await execute(text)
        const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0]?.[1]?.body))
        expect(body).toMatchObject({ blocks })
        expect(body).not.toHaveProperty('text')
      }
    )
  })

  it('schedules Block Kit with explicit fallback text and omits blank fallback', () => {
    const buildBody = slackScheduleMessageTool.request.body
    if (typeof buildBody !== 'function') throw new Error('Schedule body builder is missing')
    const params = { channel: 'C1', postAt: 2000000000, blocks: '[{"type":"divider"}]' }
    expect(buildBody({ ...params, text: 'Release ready' })).toMatchObject({
      text: 'Release ready',
      blocks: [{ type: 'divider' }],
    })
    expect(buildBody({ ...params, text: ' ' })).not.toHaveProperty('text')
  })

  it.each([
    { text: 'hello', blocks: undefined },
    { text: 'hello', blocks: [{ type: 'divider' }] },
    { text: undefined, blocks: [{ type: 'divider' }] },
  ])('preserves file-sharing content precedence for %j', async ({ text, blocks }) => {
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

    await executeSlackSendMessage(
      {
        accessToken: 'token',
        channel: 'C1',
        text,
        blocks,
        files: [{ key: 'workspace/file-1', name: 'hello.txt', size: 5 }],
      },
      {
        requestId: 'request-1',
        signal: controller.signal,
        userId: 'user-1',
      }
    )

    expect(JSON.parse(String(vi.mocked(global.fetch).mock.calls[1]?.[1]?.body))).toEqual({
      files: [{ id: 'F1' }],
      channel_id: 'C1',
      ...(blocks ? { blocks } : { initial_comment: text }),
    })
  })

  it('keeps private Slack downloads DNS-pinned and publishes the actual descriptor contract', async () => {
    const context = 'execution' as const
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
        profile: 'contentFetch',
        maxResponseBytes: MAX_FILE_SIZE,
        signal: controller.signal,
      }
    )
    assert(isInternalToolFileResult(result))
    expect(result.files).toEqual([
      { name: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf') },
    ])
    const storedFile: UserFile = {
      id: `${context}/stored-file-1/report.pdf`,
      key: `${context}/stored-file-1/report.pdf`,
      url: '/api/files/serve/stored-file-1',
      name: 'report.pdf',
      type: 'application/pdf',
      size: 3,
      context,
    }
    mocks.uploadExecution.mockResolvedValue({ ...storedFile, mimeType: 'application/pdf' })
    const response = await presentInternalToolOperationResult(
      result,
      {
        workspaceId: 'workspace-1',
        userId: 'user-1',
        workflowId: 'workflow-1',
        executionId: 'run-1',
      },
      controller.signal
    )
    const presented = await response.json()
    expect(presented).toEqual({ success: true, output: { file: storedFile } })
    const published = projectToolOutputs(slackDownloadTool.outputs).file
    expect(Object.keys(published.properties ?? {}).sort()).toEqual(
      Object.keys(presented.output.file).sort()
    )
    for (const [field, definition] of Object.entries(published.properties ?? {})) {
      expect(typeof presented.output.file[field]).toBe(definition.type)
    }
    expect(published.properties).not.toHaveProperty('data')
    expect(published.properties).not.toHaveProperty('mimeType')
  })
})
