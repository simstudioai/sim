import { assert, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isInternalToolFileResult,
  type StoredToolFile,
} from '@/lib/internal/tool-operations/file-result'

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

import { executeVantaDownloadDocumentFile } from '@/lib/internal/vanta/operations'

const context = {
  requestId: 'request-1',
  signal: new AbortController().signal,
  userId: 'user-1',
}

describe('Vanta operations', () => {
  beforeEach(() => {
    mocks.resolveFile.mockResolvedValue({
      buffer: Buffer.from('file'),
      fileName: 'evidence.txt',
      mimeType: 'text/plain',
    })
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
    assert(isInternalToolFileResult(result))
    expect(result.files).toEqual([
      { name: 'report final.pdf', mimeType: 'application/pdf', buffer: Buffer.from('hello') },
    ])
    const storedFile: StoredToolFile = {
      id: 'stored-file-1',
      key: 'execution/stored-file-1',
      url: '/api/files/serve/stored-file-1',
      name: 'report final.pdf',
      type: 'application/pdf',
      mimeType: 'application/pdf',
      size: 5,
      context: 'execution',
    }
    expect(result.present([storedFile])).toEqual({
      success: true,
      output: { file: storedFile, name: 'report final.pdf', mimeType: 'application/pdf', size: 5 },
    })
  })
})
