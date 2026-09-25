import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  resolveFile: vi.fn(),
}))

vi.mock('@/lib/internal/google-drive/client', () => ({
  asObject: (value: unknown) => toRecord(value),
  googleApiErrorMessage: (data: { error?: { message?: string } }, fallback: string) =>
    data.error?.message || fallback,
  requestGoogleDrive: mocks.request,
  responseObject: async (response: { json: () => Promise<unknown> }) => response.json(),
}))

vi.mock('@/lib/internal/google-drive/file-input', () => ({
  resolveGoogleDriveUploadFile: mocks.resolveFile,
}))

import { toRecord } from '@sim/utils/object'
import { executeGoogleDriveExport } from '@/lib/internal/google-drive/operations'
import { MAX_EXPORT_BYTES } from '@/tools/google_drive/utils'

function response(body: unknown, options: { ok?: boolean; status?: number; bytes?: number } = {}) {
  const bytes = options.bytes ?? 0
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.ok === false ? 'Bad Request' : 'OK',
    headers: new Headers(),
    body: null,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(bytes),
  }
}

const context = {
  requestId: 'request-1',
  signal: new AbortController().signal,
  userId: 'user-1',
}

describe('Google Drive operations', () => {
  beforeEach(() => {
    mocks.resolveFile.mockResolvedValue({
      buffer: Buffer.from('file'),
      contentType: 'text/plain',
      userFile: { key: 'workspace/file.txt', name: 'file.txt', size: 4, type: 'text/plain' },
    })
  })

  it('preserves the export byte limit and exact error', async () => {
    mocks.request
      .mockResolvedValueOnce(
        response({
          id: 'doc-1',
          name: 'Doc',
          mimeType: 'application/vnd.google-apps.document',
        })
      )
      .mockResolvedValueOnce(response({}, { bytes: MAX_EXPORT_BYTES + 1 }))

    await expect(
      executeGoogleDriveExport(
        { accessToken: 'token', fileId: 'doc-1', mimeType: 'application/pdf' },
        context
      )
    ).rejects.toMatchObject({
      status: 413,
      body: {
        success: false,
        error: `Exported content (${MAX_EXPORT_BYTES + 1} bytes) exceeds the ${MAX_EXPORT_BYTES}-byte export limit.`,
      },
    })
    expect(mocks.request.mock.calls[1]?.[0]).toMatchObject({
      maxResponseBytes: MAX_EXPORT_BYTES,
      signal: context.signal,
    })
  })
})
