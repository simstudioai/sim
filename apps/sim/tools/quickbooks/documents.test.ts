/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { quickbooksAddAttachmentTool } from '@/tools/quickbooks/add_attachment'
import {
  assertQuickBooksAttachmentExtension,
  buildQuickBooksAttachableMetadata,
  parseQuickBooksAttachableResponse,
  sanitizeQuickBooksFileName,
  validateQuickBooksAttachmentFileType,
} from '@/tools/quickbooks/documents_utils'
import { quickbooksDownloadAttachmentTool } from '@/tools/quickbooks/download_attachment'
import { quickbooksDownloadTransactionPdfTool } from '@/tools/quickbooks/download_transaction_pdf'
import { quickbooksReadAttachmentsTool } from '@/tools/quickbooks/read_attachments'

function attachableFaultResponse(): Response {
  return new Response(
    JSON.stringify({
      AttachableResponse: [
        {
          Fault: {
            Error: [{ code: '610', Message: 'Object Not Found', Detail: 'Attachable id 99' }],
            type: 'ValidationFault',
          },
        },
      ],
    }),
    { headers: { 'content-type': 'application/json' } }
  )
}

describe('QuickBooks file tool wiring', () => {
  it('materializes only provider input for attachment creation', () => {
    const input = quickbooksAddAttachmentTool.operation.input({
      accessToken: 'token',
      realmId: '123',
      quickBooksEnvironment: 'sandbox',
      attachmentKind: 'note',
      targetType: 'invoice',
      targetId: 'invoice-1',
      note: 'Follow up',
    })

    expect(quickbooksAddAttachmentTool.request).toBeUndefined()
    expect(input).toEqual({
      accessToken: 'token',
      realmId: '123',
      quickBooksEnvironment: 'sandbox',
      attachmentKind: 'note',
      targetType: 'invoice',
      targetId: 'invoice-1',
      file: undefined,
      fileName: undefined,
      contentType: undefined,
      description: undefined,
      note: 'Follow up',
    })
  })

  it('does not accept execution scope from attachment download parameters', () => {
    const input = quickbooksDownloadAttachmentTool.operation.input({
      accessToken: 'token',
      realmId: '123',
      quickBooksEnvironment: 'sandbox',
      attachmentId: 'attachment-1',
      fileName: 'receipt.pdf',
    })

    expect(quickbooksDownloadAttachmentTool.request).toBeUndefined()
    expect(input).toEqual({
      accessToken: 'token',
      realmId: '123',
      quickBooksEnvironment: 'sandbox',
      attachmentId: 'attachment-1',
      fileName: 'receipt.pdf',
    })
  })

  it('materializes only provider input for PDF downloads', () => {
    const input = quickbooksDownloadTransactionPdfTool.operation.input({
      accessToken: 'token',
      realmId: '123',
      quickBooksEnvironment: 'sandbox',
      transactionType: 'invoice',
      transactionId: 'invoice-1',
      fileName: 'invoice.pdf',
    })

    expect(quickbooksDownloadTransactionPdfTool.request).toBeUndefined()
    expect(input).toEqual({
      accessToken: 'token',
      realmId: '123',
      quickBooksEnvironment: 'sandbox',
      transactionType: 'invoice',
      transactionId: 'invoice-1',
      fileName: 'invoice.pdf',
    })
  })
})

describe('QuickBooks attachment file guards', () => {
  it('refuses an unsupported extension from the file name alone', () => {
    expect(() => assertQuickBooksAttachmentExtension('backup.zip')).toThrow(
      'QuickBooks does not support the zip file type'
    )
    expect(() => assertQuickBooksAttachmentExtension('backup')).toThrow(
      'QuickBooks does not support an extensionless file type'
    )
    expect(() => assertQuickBooksAttachmentExtension('receipt.pdf')).not.toThrow()
  })

  it('canonicalizes a .jpg upload to image/jpeg', () => {
    expect(validateQuickBooksAttachmentFileType('photo.jpg', 'image/jpg')).toBe('image/jpeg')
    expect(validateQuickBooksAttachmentFileType('photo.jpg', 'image/pjpeg')).toBe('image/jpeg')
    expect(() => validateQuickBooksAttachmentFileType('photo.jpg', 'image/png')).toThrow(
      'QuickBooks does not support the jpg / image/png file type combination'
    )
  })

  it('reduces a traversal-shaped file name to a safe leaf', () => {
    expect(sanitizeQuickBooksFileName('../../etc/passwd', 'fallback.pdf')).toBe('passwd')
    expect(sanitizeQuickBooksFileName('..', 'fallback.pdf')).toBe('fallback.pdf')
  })

  it('builds the documented Attachable metadata for the file_metadata_01 part', () => {
    expect(
      buildQuickBooksAttachableMetadata('invoice', 'invoice-1', {
        fileName: 'receipt.pdf',
        contentType: 'application/pdf',
        note: 'Signed copy',
      })
    ).toEqual({
      AttachableRef: [{ EntityRef: { type: 'Invoice', value: 'invoice-1' } }],
      FileName: 'receipt.pdf',
      ContentType: 'application/pdf',
      Note: 'Signed copy',
    })
  })
})

describe('QuickBooks Attachable fault reporting', () => {
  it('names the read operation when a read returns a nested fault', async () => {
    await expect(
      parseQuickBooksAttachableResponse(attachableFaultResponse(), undefined, 'attachment read')
    ).rejects.toThrow(/^QuickBooks attachment read failed:/)
  })

  it('still names the upload operation for callers that supply no label', async () => {
    await expect(parseQuickBooksAttachableResponse(attachableFaultResponse())).rejects.toThrow(
      /^QuickBooks attachment upload failed:/
    )
  })

  it('routes attachment reads through the labelled parser', async () => {
    await expect(
      quickbooksReadAttachmentsTool.transformResponse?.(attachableFaultResponse(), {
        accessToken: 'token',
        realmId: '123',
        quickBooksEnvironment: 'sandbox',
        readMode: 'by_id',
        attachmentId: 'attachment-1',
      })
    ).rejects.toThrow(/^QuickBooks attachment read failed:/)
  })
})
