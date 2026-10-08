import { assert, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isInternalToolFileResult,
  type StoredToolFile,
} from '@/lib/internal/tool-operations/file-result'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  resolveFile: vi.fn(),
}))

vi.mock('@/lib/internal/vanta/file-input', () => ({
  resolveVantaUploadFile: mocks.resolveFile,
}))

import {
  executeVantaDownloadDocumentFile,
  executeVantaQuery,
} from '@/lib/internal/vanta/operations'

const context = {
  requestId: 'request-1',
  signal: new AbortController().signal,
  userId: 'user-1',
}

describe('Vanta operations', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.resolveFile.mockResolvedValue({
      buffer: Buffer.from('file'),
      fileName: 'evidence.txt',
      mimeType: 'text/plain',
    })
  })

  it('downloads files with exact binary projection and filename parsing', async () => {
    mocks.fetch.mockResolvedValue(
      new Response('hello', {
        headers: {
          'Content-Disposition': "attachment; filename*=UTF-8''report%20final.pdf",
          'Content-Type': 'application/pdf',
        },
      })
    )

    const result = await executeVantaDownloadDocumentFile(
      {
        accessToken: 'saved-credential-token',
        apiDomain: 'https://api.vanta.com',
        documentId: 'document-1',
        uploadedFileId: 'upload-1',
      },
      context
    )

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

  it.each([
    'https://attacker.example',
    'https://api.vanta.com.attacker.example',
    'https://api.vanta.com@attacker.example',
    'https://api.vanta.com/path',
    'http://api.vanta.com',
    'http://127.0.0.1',
  ])('rejects a credential destination outside Vanta before egress: %s', async (apiDomain) => {
    await expect(
      executeVantaQuery({
        operation: 'vanta_list_frameworks',
        accessToken: 'saved-credential-token',
        apiDomain,
      })
    ).rejects.toThrow('Invalid Vanta API domain')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each(['https://api.vanta.com', 'https://api.vanta-gov.com'])(
    'keeps the credential token bound to its API deployment: %s',
    async (apiDomain) => {
      mocks.fetch.mockImplementation(async (url, init) => {
        expect(String(url)).toBe(`${apiDomain}/v1/frameworks`)
        expect(new Headers(init?.headers).get('authorization')).toBe(
          'Bearer saved-credential-token'
        )
        expect(init?.redirect).toBe('error')
        return Response.json({
          results: {
            data: [],
            pageInfo: {
              endCursor: null,
              startCursor: null,
              hasNextPage: false,
              hasPreviousPage: false,
            },
          },
        })
      })
      const result = await executeVantaQuery({
        operation: 'vanta_list_frameworks',
        accessToken: 'saved-credential-token',
        apiDomain,
      })
      expect(result).toMatchObject({ success: true, output: { frameworks: [] } })
    }
  )
})
