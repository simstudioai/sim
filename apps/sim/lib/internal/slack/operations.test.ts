import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isInternalToolFileResult,
  type StoredToolFile,
} from '@/lib/internal/tool-operations/file-result'

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

import { executeSlackDownload } from '@/lib/internal/slack/operations'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

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
        profile: 'contentFetch',
        maxResponseBytes: MAX_FILE_SIZE,
        signal: controller.signal,
      }
    )
    assert(isInternalToolFileResult(result))
    expect(result.files).toEqual([
      { name: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf') },
    ])
    const storedFile: StoredToolFile = {
      id: 'stored-file-1',
      key: 'execution/stored-file-1',
      url: '/api/files/serve/stored-file-1',
      name: 'report.pdf',
      type: 'application/pdf',
      mimeType: 'application/pdf',
      size: 3,
      context: 'execution',
    }
    expect(result.present([storedFile])).toEqual({ success: true, output: { file: storedFile } })
  })
})
