/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  secureFetchWithPinnedIP: vi.fn(),
  secureFetchWithValidation: vi.fn(),
  validateUrlWithDNS: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.secureFetchWithPinnedIP,
  secureFetchWithValidation: mocks.secureFetchWithValidation,
  validateUrlWithDNS: mocks.validateUrlWithDNS,
}))

import { uploadClickUpAttachment } from '@/lib/internal/clickup/client'
import { sendDiscordMessage } from '@/lib/internal/discord/client'
import type { DiscordOperationError } from '@/lib/internal/discord/errors'
import { registerLinqAttachment, uploadLinqAttachmentBytes } from '@/lib/internal/linq/client'
import { uploadDataverseFile } from '@/lib/internal/microsoft-dataverse/client'
import { downloadPipedriveFile, listPipedriveFiles } from '@/lib/internal/pipedrive/client'
import { uploadServiceNowAttachment } from '@/lib/internal/servicenow/client'

describe('file and message provider clients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.validateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
  })

  it('forwards cancellation to the bounded ClickUp attachment request', async () => {
    const controller = new AbortController()
    mocks.fetch.mockResolvedValue(
      Response.json({ id: 'attachment-1' }, { headers: { 'content-length': '21' } })
    )

    await uploadClickUpAttachment('token', 'task-1', new FormData(), controller.signal)

    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/task/task-1/attachment'),
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it('preserves Discord provider status and error envelopes', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ message: 'Missing Access' }, { status: 403 }))

    await expect(sendDiscordMessage('token', '123456789012345678', '{}', 'json')).rejects.toEqual(
      expect.objectContaining<DiscordOperationError>({ message: 'Missing Access', status: 403 })
    )
  })

  it('DNS-pins Linq presigned uploads and forwards cancellation to both steps', async () => {
    const controller = new AbortController()
    mocks.fetch.mockResolvedValue(
      Response.json({
        attachment_id: 'attachment-1',
        upload_url: 'https://upload.example/file',
        required_headers: { 'Content-Type': 'text/plain' },
      })
    )
    mocks.secureFetchWithPinnedIP.mockResolvedValue(new Response(null, { status: 204 }))
    const registration = await registerLinqAttachment(
      { apiKey: 'key', contentType: 'text/plain', filename: 'a.txt', sizeBytes: 1 },
      controller.signal
    )

    await uploadLinqAttachmentBytes(registration, Buffer.from('a'), controller.signal)

    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/attachments'),
      expect.objectContaining({ signal: controller.signal })
    )
    expect(mocks.secureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://upload.example/file',
      '203.0.113.10',
      expect.objectContaining({ signal: controller.signal, maxResponseBytes: expect.any(Number) })
    )
  })

  it('drops Dataverse bearer credentials on redirects and bounds its response', async () => {
    const controller = new AbortController()
    mocks.secureFetchWithValidation.mockResolvedValue(new Response(null, { status: 204 }))

    await uploadDataverseFile(
      {
        accessToken: 'token',
        fileName: 'a.txt',
        uploadUrl: 'https://org.crm.dynamics.com/api/data/v9.2/accounts(1)/document',
      },
      Buffer.from('a'),
      controller.signal
    )

    expect(mocks.secureFetchWithValidation).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        maxResponseBytes: 10 * 1024 * 1024,
        signal: controller.signal,
        stripAuthOnRedirect: true,
      }),
      'environmentUrl'
    )
  })

  it('bounds and cancels ServiceNow upload responses', async () => {
    const controller = new AbortController()
    mocks.secureFetchWithValidation.mockResolvedValue(
      Response.json({ result: { sys_id: 'attachment-1', file_name: 'a.txt' } })
    )

    const result = await uploadServiceNowAttachment(
      {
        contentType: 'text/plain',
        fileName: 'a.txt',
        instanceUrl: 'https://example.service-now.com',
        password: 'password',
        recordSysId: 'record-1',
        tableName: 'incident',
        username: 'user',
      },
      Buffer.from('a'),
      controller.signal
    )

    expect(result).toEqual(expect.objectContaining({ sys_id: 'attachment-1' }))
    expect(mocks.secureFetchWithValidation).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        maxResponseBytes: 10 * 1024 * 1024,
        signal: controller.signal,
      }),
      'instanceUrl'
    )
  })

  it('uses DNS pinning and never sends Pipedrive credentials to external download hosts', async () => {
    mocks.secureFetchWithPinnedIP
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          data: [{ id: 1, name: 'a.txt', url: 'https://cdn.example/a.txt' }],
          additional_data: {
            pagination: { more_items_in_collection: false, next_start: 1 },
          },
        })
      )
      .mockResolvedValueOnce(new Response('abc', { headers: { 'content-type': 'text/plain' } }))

    const page = await listPipedriveFiles({ accessToken: 'token' })
    const downloaded = await downloadPipedriveFile(
      page.files[0].url as string,
      { accessToken: 'token' },
      100
    )

    expect(downloaded?.buffer.toString()).toBe('abc')
    expect(mocks.secureFetchWithPinnedIP).toHaveBeenLastCalledWith(
      'https://cdn.example/a.txt',
      '203.0.113.10',
      expect.objectContaining({ headers: {}, maxResponseBytes: 100 })
    )
  })
})
