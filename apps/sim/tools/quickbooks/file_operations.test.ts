/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { quickbooksAddAttachmentTool } from '@/tools/quickbooks/add_attachment'
import { quickbooksDownloadAttachmentTool } from '@/tools/quickbooks/download_attachment'
import { quickbooksDownloadTransactionPdfTool } from '@/tools/quickbooks/download_transaction_pdf'

describe('QuickBooks file tools', () => {
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
