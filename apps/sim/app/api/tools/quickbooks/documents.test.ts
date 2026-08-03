/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  hybridAuthMockFns,
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

const {
  mockAssertToolFileAccess,
  mockDownloadServableFileFromStorage,
  mockProcessFilesToUserFiles,
} = vi.hoisted(() => ({
  mockAssertToolFileAccess: vi.fn(),
  mockDownloadServableFileFromStorage: vi.fn(),
  mockProcessFilesToUserFiles: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mockAssertToolFileAccess,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: mockProcessFilesToUserFiles,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mockDownloadServableFileFromStorage,
}))

import { POST as addAttachment } from '@/app/api/tools/quickbooks/add-attachment/route'
import { POST as downloadAttachment } from '@/app/api/tools/quickbooks/download-attachment/route'
import { POST as downloadTransactionPdf } from '@/app/api/tools/quickbooks/download-transaction-pdf/route'

const mockFetch = vi.fn()
const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = inputValidationMockFns
const auth = { accessToken: 'access-token', realmId: '123456789' }
const attachmentFile = {
  key: 'workspace/receipt.pdf',
  name: 'receipt.pdf',
  size: 16,
  type: 'application/pdf',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)
  hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    authType: 'internal_jwt',
  })
  mockProcessFilesToUserFiles.mockReturnValue([attachmentFile])
  mockAssertToolFileAccess.mockResolvedValue(null)
  mockDownloadServableFileFromStorage.mockResolvedValue({
    buffer: Buffer.from('%PDF-1.4 fixture'),
    contentType: 'application/pdf',
  })
  mockValidateUrlWithDNS.mockResolvedValue({
    isValid: true,
    resolvedIP: '203.0.113.8',
    originalHostname: 'intuit-download.example',
  })
})

describe('QuickBooks document API routes', () => {
  it('authenticates before parsing a PDF request', async () => {
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorized',
    })

    const response = await downloadTransactionPdf(createMockRequest('POST', {}))

    expect(response.status).toBe(401)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('downloads one bounded transaction PDF with a safe filename', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('%PDF-1.4 fixture', {
        headers: { 'content-type': 'application/pdf' },
      })
    )

    const response = await downloadTransactionPdf(
      createMockRequest('POST', {
        ...auth,
        transactionType: 'invoice',
        transactionId: 'A/B',
        fileName: '../invoice.pdf',
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.output.fileName).toBe('invoice.pdf')
    expect(body.output.file.data).toBe(Buffer.from('%PDF-1.4 fixture').toString('base64'))
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(String(mockFetch.mock.calls[0][0])).toContain('/invoice/A%2FB/pdf')
  })

  it('rejects non-PDF and oversized PDF responses', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('not a PDF', { headers: { 'content-type': 'text/plain' } })
    )
    const nonPdf = await downloadTransactionPdf(
      createMockRequest('POST', {
        ...auth,
        transactionType: 'invoice',
        transactionId: '1',
      })
    )
    expect(nonPdf.status).toBe(500)

    mockFetch.mockResolvedValueOnce(new Response(new Uint8Array(Buffer.from('%PDF-1.4 fixture'))))
    const missingContentType = await downloadTransactionPdf(
      createMockRequest('POST', {
        ...auth,
        transactionType: 'invoice',
        transactionId: '1',
      })
    )
    expect(missingContentType.status).toBe(500)
    await expect(missingContentType.json()).resolves.toMatchObject({
      error: 'QuickBooks returned a non-PDF response',
    })

    mockFetch.mockResolvedValueOnce(
      new Response('%PDF-', {
        headers: {
          'content-type': 'application/pdf',
          'content-length': String(MAX_FILE_SIZE + 1),
        },
      })
    )
    const oversized = await downloadTransactionPdf(
      createMockRequest('POST', {
        ...auth,
        transactionType: 'invoice',
        transactionId: '1',
      })
    )
    expect(oversized.status).toBe(413)
  })

  it('creates a note attachment with one JSON request', async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        Attachable: {
          Id: '9',
          Note: 'Audit note',
          TempDownloadUri: 'https://example.invalid/temp?token=secret',
          ThumbnailTempDownloadUri: 'https://example.invalid/thumbnail?token=secret',
        },
        time: '2026-08-02',
      })
    )

    const response = await addAttachment(
      createMockRequest('POST', {
        ...auth,
        attachmentKind: 'note',
        targetType: 'invoice',
        targetId: '77',
        note: 'Audit note',
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.output).toMatchObject({ attachmentId: '9', attachmentKind: 'note' })
    expect(body.output.attachment).toEqual({ Id: '9', Note: 'Audit note' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
      Note: 'Audit note',
      AttachableRef: [{ EntityRef: { type: 'Invoice', value: '77' } }],
    })
  })

  it('authorizes and uploads one workspace file using the verified multipart names', async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({ AttachableResponse: [{ Attachable: { Id: '10' } }], time: '2026-08-02' })
    )

    const response = await addAttachment(
      createMockRequest('POST', {
        ...auth,
        attachmentKind: 'file',
        targetType: 'bill',
        targetId: '88',
        file: attachmentFile,
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.output.attachmentId).toBe('10')
    expect(mockAssertToolFileAccess).toHaveBeenCalledWith(
      attachmentFile.key,
      'user-1',
      expect.any(String),
      expect.anything()
    )
    expect(mockDownloadServableFileFromStorage).toHaveBeenCalledTimes(1)
    expect(mockDownloadServableFileFromStorage).toHaveBeenCalledWith(
      attachmentFile,
      expect.any(String),
      expect.anything(),
      { maxBytes: MAX_FILE_SIZE }
    )
    const formData = mockFetch.mock.calls[0][1].body as FormData
    expect(formData.get('file_metadata_01')).toBeInstanceOf(Blob)
    expect(formData.get('file_content_01')).toBeInstanceOf(Blob)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects an unauthorized workspace file before storage or Intuit access', async () => {
    mockAssertToolFileAccess.mockResolvedValueOnce(
      Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
    )

    const response = await addAttachment(
      createMockRequest('POST', {
        ...auth,
        attachmentKind: 'file',
        targetType: 'bill',
        targetId: '88',
        file: attachmentFile,
      })
    )

    expect(response.status).toBe(403)
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects mixed attachment modes, empty files, invalid MIME pairs, and oversized files', async () => {
    const mixed = await addAttachment(
      createMockRequest('POST', {
        ...auth,
        attachmentKind: 'note',
        targetType: 'invoice',
        targetId: '1',
        note: 'Audit note',
        file: attachmentFile,
      })
    )
    expect(mixed.status).toBe(400)

    mockProcessFilesToUserFiles.mockReturnValueOnce([
      { ...attachmentFile, size: MAX_FILE_SIZE + 1 },
    ])
    const declaredOversized = await addAttachment(
      createMockRequest('POST', {
        ...auth,
        attachmentKind: 'file',
        targetType: 'invoice',
        targetId: '1',
        file: attachmentFile,
      })
    )
    expect(declaredOversized.status).toBe(413)
    expect(mockAssertToolFileAccess).not.toHaveBeenCalled()
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()

    mockDownloadServableFileFromStorage.mockResolvedValueOnce({
      buffer: Buffer.alloc(0),
      contentType: 'application/pdf',
    })
    const empty = await addAttachment(
      createMockRequest('POST', {
        ...auth,
        attachmentKind: 'file',
        targetType: 'invoice',
        targetId: '1',
        file: attachmentFile,
      })
    )
    expect(empty.status).toBe(500)
    expect(mockFetch).not.toHaveBeenCalled()

    mockDownloadServableFileFromStorage.mockResolvedValueOnce({
      buffer: Buffer.from('not an image'),
      contentType: 'image/png',
    })
    const invalidMime = await addAttachment(
      createMockRequest('POST', {
        ...auth,
        attachmentKind: 'file',
        targetType: 'invoice',
        targetId: '1',
        file: attachmentFile,
      })
    )
    expect(invalidMime.status).toBe(500)
    expect(mockFetch).not.toHaveBeenCalled()

    mockDownloadServableFileFromStorage.mockResolvedValueOnce({
      buffer: { length: MAX_FILE_SIZE + 1 },
      contentType: 'application/pdf',
    })
    const oversized = await addAttachment(
      createMockRequest('POST', {
        ...auth,
        attachmentKind: 'file',
        targetType: 'invoice',
        targetId: '1',
        file: attachmentFile,
      })
    )
    expect(oversized.status).toBe(413)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('downloads an attachment with exactly two external requests and no token on the binary request', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('https://intuit-download.example/receipt.pdf', {
        headers: { 'content-type': 'text/plain' },
      })
    )
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      new Response('file bytes', {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="receipt.pdf"',
        },
      })
    )

    const response = await downloadAttachment(
      createMockRequest('POST', { ...auth, attachmentId: '15' })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.output).toMatchObject({
      attachmentId: '15',
      fileName: 'receipt.pdf',
      mimeType: 'application/pdf',
      size: 10,
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockValidateUrlWithDNS).toHaveBeenCalledWith(
      'https://intuit-download.example/receipt.pdf',
      'QuickBooks attachment URL'
    )
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://intuit-download.example/receipt.pdf',
      '203.0.113.8',
      { method: 'GET', maxResponseBytes: MAX_FILE_SIZE, stripAuthOnRedirect: true }
    )
  })

  it('uses the binary fallback MIME type when an attachment response omits Content-Type', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('https://intuit-download.example/attachment.bin', {
        headers: { 'content-type': 'text/plain' },
      })
    )
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))

    const response = await downloadAttachment(
      createMockRequest('POST', { ...auth, attachmentId: '16' })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.output).toMatchObject({
      attachmentId: '16',
      fileName: 'attachment.bin',
      mimeType: 'application/octet-stream',
      size: 3,
    })
  })

  it('rejects note-only and oversized attachment downloads', async () => {
    mockFetch.mockResolvedValueOnce(new Response(''))
    const note = await downloadAttachment(
      createMockRequest('POST', { ...auth, attachmentId: '16' })
    )
    expect(note.status).toBe(500)
    expect((await note.json()).error).toContain('no downloadable file')
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()

    mockFetch.mockResolvedValueOnce(
      new Response('https://intuit-download.example/note', {
        headers: { 'content-type': 'text/plain' },
      })
    )
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(new Response('{}', { status: 404 }))
    const noteWithTemporaryUrl = await downloadAttachment(
      createMockRequest('POST', { ...auth, attachmentId: '16' })
    )
    expect(noteWithTemporaryUrl.status).toBe(500)
    expect((await noteWithTemporaryUrl.json()).error).toContain('no downloadable file')

    mockFetch.mockResolvedValueOnce(new Response('https://intuit-download.example/large.pdf'))
    mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      new Response('x', { headers: { 'content-length': String(MAX_FILE_SIZE + 1) } })
    )
    const oversized = await downloadAttachment(
      createMockRequest('POST', { ...auth, attachmentId: '17' })
    )
    expect(oversized.status).toBe(413)
  })

  it('caps the temporary URL response independently and keeps QBO fault guidance sanitized', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('x', { headers: { 'content-length': String(64 * 1024 + 1) } })
    )
    const oversizedUrl = await downloadAttachment(
      createMockRequest('POST', { ...auth, attachmentId: '18' })
    )
    expect(oversizedUrl.status).toBe(413)
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()

    mockFetch.mockResolvedValueOnce(
      Response.json(
        { Fault: { Error: [{ code: '3200', Message: 'Token expired' }] } },
        { status: 401, headers: { intuit_tid: 'tracking-1' } }
      )
    )
    const unauthorized = await downloadTransactionPdf(
      createMockRequest('POST', {
        ...auth,
        transactionType: 'invoice',
        transactionId: '1',
      })
    )
    const body = await unauthorized.json()
    expect(body.error).toContain('Reconnect the QuickBooks credential')
    expect(body.error).toContain('tracking-1')
    expect(body.error).not.toContain('access-token')
  })
})
