/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchAuth: vi.fn(),
  resolveFile: vi.fn(),
}))

vi.mock('@/lib/internal/vanta/client', () => ({
  fetchVantaWithAuth: mocks.fetchAuth,
  getVantaBaseUrl: (region?: string) =>
    region === 'gov' ? 'https://api.vanta-gov.com' : 'https://api.vanta.com',
  VANTA_DOCUMENT_UPLOAD_SCOPE: 'vanta-api.all:read vanta-api.all:write vanta-api.documents:upload',
  VANTA_READ_SCOPE: 'vanta-api.all:read',
}))

vi.mock('@/lib/internal/vanta/file-input', () => ({
  resolveVantaUploadFile: mocks.resolveFile,
}))

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { VANTA_MAX_TRANSFER_BYTES } from '@/lib/internal/vanta/input'
import {
  executeVantaDownloadDocumentFile,
  executeVantaQuery,
  executeVantaUploadDocumentFile,
} from '@/lib/internal/vanta/operations'

const context = {
  requestId: 'request-1',
  signal: new AbortController().signal,
  userId: 'user-1',
}

describe('Vanta operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveFile.mockResolvedValue({
      buffer: Buffer.from('file'),
      fileName: 'evidence.txt',
      mimeType: 'text/plain',
    })
  })

  it('uploads authorized files with provider cancellation and exact output', async () => {
    mocks.fetchAuth.mockImplementation(
      async (_params: unknown, perform: (token: string) => Promise<Response>) => perform('token')
    )
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ id: 'upload-1', fileName: 'evidence.txt', mimeType: 'text/plain' })
      )

    const result = await executeVantaUploadDocumentFile(
      {
        clientId: 'client',
        clientSecret: 'secret',
        documentId: 'document-1',
        file: { key: 'workspace/file.txt', name: 'file.txt', size: 4 },
        description: 'Evidence',
      },
      context
    )

    expect(mocks.resolveFile).toHaveBeenCalledWith(expect.anything(), context)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.vanta.com/v1/documents/document-1/uploads',
      expect.objectContaining({ method: 'POST', signal: context.signal })
    )
    expect(result).toMatchObject({
      success: true,
      output: { upload: { id: 'upload-1', fileName: 'evidence.txt' } },
    })
    fetchMock.mockRestore()
  })

  it('downloads files with exact binary projection and filename parsing', async () => {
    mocks.fetchAuth.mockResolvedValue(
      new Response('hello', {
        headers: {
          'Content-Disposition': "attachment; filename*=UTF-8''report%20final.pdf",
          'Content-Type': 'application/pdf',
        },
      })
    )

    const result = await executeVantaDownloadDocumentFile(
      {
        clientId: 'client',
        clientSecret: 'secret',
        documentId: 'document-1',
        uploadedFileId: 'upload-1',
      },
      context
    )

    expect(mocks.fetchAuth.mock.calls[0]?.[2]).toEqual({ signal: context.signal })
    expect(result).toEqual({
      success: true,
      output: {
        file: {
          name: 'report final.pdf',
          mimeType: 'application/pdf',
          data: Buffer.from('hello').toString('base64'),
          size: 5,
        },
        name: 'report final.pdf',
        mimeType: 'application/pdf',
        size: 5,
      },
    })
  })

  it('preserves provider and download-size error envelopes', async () => {
    mocks.fetchAuth.mockResolvedValueOnce(
      Response.json({ error: { message: 'Not found' } }, { status: 404 })
    )
    await expect(
      executeVantaDownloadDocumentFile(
        {
          clientId: 'client',
          clientSecret: 'secret',
          documentId: 'document-1',
          uploadedFileId: 'missing',
        },
        context
      )
    ).rejects.toMatchObject({
      status: 404,
      body: { success: false, error: 'Not found' },
    })

    let cancelled = false
    mocks.fetchAuth.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          cancel: () => {
            cancelled = true
          },
        }),
        { headers: { 'Content-Length': String(VANTA_MAX_TRANSFER_BYTES + 1) } }
      )
    )
    await expect(
      executeVantaDownloadDocumentFile(
        {
          clientId: 'client',
          clientSecret: 'secret',
          documentId: 'document-1',
          uploadedFileId: 'large',
        },
        context
      )
    ).rejects.toMatchObject({
      status: 400,
      body: { success: false, error: 'File size (100.00MB) exceeds download limit of 100MB' },
    })
    expect(cancelled).toBe(true)
  })

  it('maps unknown-length streamed overflow to the legacy error', async () => {
    const streamError = new PayloadSizeLimitError({
      label: 'Vanta document file',
      maxBytes: VANTA_MAX_TRANSFER_BYTES,
      observedBytes: VANTA_MAX_TRANSFER_BYTES + 1,
    })
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => controller.error(streamError),
    })
    mocks.fetchAuth.mockResolvedValue(new Response(body))

    await expect(
      executeVantaDownloadDocumentFile(
        {
          clientId: 'client',
          clientSecret: 'secret',
          documentId: 'document-1',
          uploadedFileId: 'large',
        },
        context
      )
    ).rejects.toMatchObject({
      status: 400,
      body: { success: false, error: 'File exceeds download limit of 100MB' },
    })
  })

  it('executes query operations directly with exact provider URL and normalized output', async () => {
    mocks.fetchAuth.mockImplementation(
      async (_params: unknown, perform: (token: string) => Promise<Response>) => perform('token')
    )
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        results: {
          data: [{ id: 'framework-1', displayName: 'SOC 2' }],
          pageInfo: { endCursor: 'cursor-1', hasNextPage: true },
        },
      })
    )

    const result = await executeVantaQuery(
      {
        operation: 'vanta_list_frameworks',
        clientId: 'client',
        clientSecret: 'secret',
        pageSize: 25,
        pageCursor: 'cursor-0',
      },
      context.signal
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.vanta.com/v1/frameworks?pageSize=25&pageCursor=cursor-0',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
        signal: context.signal,
      })
    )
    expect(result).toMatchObject({
      success: true,
      output: {
        frameworks: [{ id: 'framework-1', displayName: 'SOC 2' }],
        pageInfo: { endCursor: 'cursor-1', hasNextPage: true },
      },
    })
    fetchMock.mockRestore()
  })
})
