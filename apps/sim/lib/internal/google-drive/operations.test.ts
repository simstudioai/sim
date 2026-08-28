/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  resolveFile: vi.fn(),
}))

vi.mock('@/lib/internal/google-drive/client', () => ({
  asObject: (value: unknown) =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {},
  googleApiErrorMessage: (data: { error?: { message?: string } }, fallback: string) =>
    data.error?.message || fallback,
  requestGoogleDrive: mocks.request,
  responseObject: async (response: { json: () => Promise<unknown> }) => response.json(),
}))

vi.mock('@/lib/internal/google-drive/file-input', () => ({
  resolveGoogleDriveUploadFile: mocks.resolveFile,
}))

import {
  executeGoogleDriveDownload,
  executeGoogleDriveExport,
  executeGoogleDriveUpload,
} from '@/lib/internal/google-drive/operations'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
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
    vi.clearAllMocks()
    mocks.resolveFile.mockResolvedValue({
      buffer: Buffer.from('file'),
      contentType: 'text/plain',
      userFile: { key: 'workspace/file.txt', name: 'file.txt', size: 4, type: 'text/plain' },
    })
  })

  it('downloads regular files with metadata and binary caps', async () => {
    mocks.request
      .mockResolvedValueOnce(
        response({
          id: 'file-1',
          name: 'report.pdf',
          mimeType: 'application/pdf',
          size: '4',
          capabilities: { canReadRevisions: false },
        })
      )
      .mockResolvedValueOnce(response({}, { bytes: 4 }))

    const result = await executeGoogleDriveDownload(
      { accessToken: 'token', fileId: 'file-1', includeRevisions: true },
      context
    )

    expect(mocks.request.mock.calls[1]?.[0]).toMatchObject({
      label: 'downloadUrl',
      maxResponseBytes: MAX_FILE_SIZE,
      signal: context.signal,
    })
    expect(result.output.file).toEqual({
      name: 'report.pdf',
      mimeType: 'application/pdf',
      data: 'AAAAAA==',
      size: 4,
    })
  })

  it('keeps revision lookup optional and bounded', async () => {
    mocks.request
      .mockResolvedValueOnce(
        response({
          id: 'file-1',
          name: 'report.pdf',
          mimeType: 'application/pdf',
          capabilities: { canReadRevisions: true },
        })
      )
      .mockResolvedValueOnce(response({}, { bytes: 1 }))
      .mockResolvedValueOnce(response({ revisions: [{ id: 'rev-1' }] }))

    const result = await executeGoogleDriveDownload(
      { accessToken: 'token', fileId: 'file-1', includeRevisions: true },
      context
    )

    expect(mocks.request.mock.calls[2]?.[0]).toMatchObject({
      label: 'revisionsUrl',
      signal: context.signal,
    })
    expect(result.output.metadata.revisions).toEqual([{ id: 'rev-1' }])
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

  it('runs text uploads entirely inside the typed operation', async () => {
    mocks.request
      .mockResolvedValueOnce(response({ id: 'file-1' }))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ id: 'file-1', name: 'notes.txt', mimeType: 'text/plain' }))

    const result = await executeGoogleDriveUpload(
      {
        accessToken: 'token',
        fileName: 'notes.txt',
        content: 'hello',
        mimeType: 'text/plain',
      },
      context
    )

    expect(mocks.request.mock.calls.map((call) => call[0].label)).toEqual([
      'createFileUrl',
      'uploadContentUrl',
      'finalFileUrl',
    ])
    expect(mocks.request.mock.calls[1]?.[0]).toMatchObject({
      body: 'hello',
      method: 'PATCH',
      signal: context.signal,
    })
    expect(result.output.file).toMatchObject({ id: 'file-1', name: 'notes.txt' })
  })

  it('uses the authorized stored-file resolver and multipart provider upload', async () => {
    mocks.request
      .mockResolvedValueOnce(response({ id: 'file-1' }))
      .mockResolvedValueOnce(response({ id: 'file-1', name: 'file.txt', mimeType: 'text/plain' }))

    const result = await executeGoogleDriveUpload(
      {
        accessToken: 'token',
        fileName: 'file.txt',
        file: { key: 'workspace/file.txt', name: 'file.txt', size: 4 },
      },
      context
    )

    expect(mocks.resolveFile).toHaveBeenCalledWith(
      { key: 'workspace/file.txt', name: 'file.txt', size: 4 },
      context
    )
    expect(mocks.request.mock.calls[0]?.[0]).toMatchObject({
      label: 'uploadFileUrl',
      method: 'POST',
      signal: context.signal,
    })
    expect(String(mocks.request.mock.calls[0]?.[0].body)).toContain('ZmlsZQ==')
    expect(result.output.file).toMatchObject({ id: 'file-1', name: 'file.txt' })
  })
})
