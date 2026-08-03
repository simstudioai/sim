import { resetEnvMock, setEnv } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QuickBooksBlock } from '@/blocks/blocks/quickbooks'
import {
  getQuickBooksAttachmentTarget,
  parseQuickBooksAttachableResponse,
  QUICKBOOKS_INTERNAL_FILE_RESPONSE_MAX_BYTES,
  sanitizeQuickBooksAttachable,
  sanitizeQuickBooksFileName,
  validateQuickBooksAttachmentFileType,
} from '@/tools/quickbooks/documents_utils'
import { quickbooksDownloadAttachmentTool } from '@/tools/quickbooks/download_attachment'
import { quickbooksDownloadTransactionPdfTool } from '@/tools/quickbooks/download_transaction_pdf'
import { quickbooksEmailTransactionTool } from '@/tools/quickbooks/email_transaction'
import { quickbooksReadAttachmentsTool } from '@/tools/quickbooks/read_attachments'
import type {
  QuickBooksDocumentTransactionType,
  QuickBooksEmailTransactionParams,
  QuickBooksReadAttachmentsParams,
} from '@/tools/quickbooks/types'
import { QUICKBOOKS_EMAILABLE_TRANSACTION_PROPERTIES } from '@/tools/quickbooks/types'

const auth = { accessToken: 'access-token', realmId: '123456789' }

beforeEach(() => setEnv({ QUICKBOOKS_ENV: 'sandbox' }))
afterEach(resetEnvMock)

describe('QuickBooks document tools', () => {
  it.each([
    ['credit_memo', 'creditmemo'],
    ['estimate', 'estimate'],
    ['invoice', 'invoice'],
    ['purchase_order', 'purchaseorder'],
    ['refund_receipt', 'refundreceipt'],
    ['sales_receipt', 'salesreceipt'],
  ] as const)('maps %s to a fixed email endpoint', (transactionType, resource) => {
    const requestUrl = quickbooksEmailTransactionTool.request.url as (
      params: QuickBooksEmailTransactionParams
    ) => string
    const url = new URL(
      requestUrl({
        ...auth,
        transactionType,
        transactionId: ' A/B ',
        recipient: ' accountant@example.com ',
        confirmSend: true,
      })
    )
    expect(url.pathname).toBe(`/v3/company/123456789/${resource}/A%2FB/send`)
    expect(url.searchParams.get('sendTo')).toBe('accountant@example.com')
    expect(url.searchParams.get('minorversion')).toBe('75')
  })

  it('requires confirmation and rejects recipient lists and header injection before fetch', () => {
    const requestUrl = quickbooksEmailTransactionTool.request.url as (
      params: QuickBooksEmailTransactionParams
    ) => string
    const base = {
      ...auth,
      transactionType: 'invoice' as const,
      transactionId: '1',
      confirmSend: true,
    }
    expect(() => requestUrl({ ...base, confirmSend: false })).toThrow('Confirm sending')
    expect(() => requestUrl({ ...base, recipient: 'a@example.com,b@example.com' })).toThrow(
      'one valid email'
    )
    expect(() => requestUrl({ ...base, recipient: 'a@example.com\r\nBcc:x@example.com' })).toThrow(
      'one valid email'
    )
  })

  it('preserves a verified native record from a successful email response', async () => {
    await expect(
      quickbooksEmailTransactionTool.transformResponse!(
        Response.json({
          Invoice: { Id: '12', SyncToken: '1', EmailStatus: 'EmailSent' },
          time: 'test-time',
        }),
        { ...auth, transactionType: 'invoice', transactionId: '12', confirmSend: true }
      )
    ).resolves.toMatchObject({
      output: {
        transactionType: 'invoice',
        transactionId: '12',
        sent: true,
        record: { Id: '12', EmailStatus: 'EmailSent' },
        time: 'test-time',
      },
    })
  })

  it('advertises one optional sales and purchasing transaction output superset', () => {
    const record = quickbooksEmailTransactionTool.outputs?.record
    expect(record?.properties).toBe(QUICKBOOKS_EMAILABLE_TRANSACTION_PROPERTIES)
    expect(record?.properties).toMatchObject({
      CustomerRef: { optional: true },
      ExpirationDate: { optional: true },
      VendorRef: { optional: true },
      APAccountRef: { optional: true },
      POStatus: { optional: true },
      LinkedTxn: { optional: true },
    })
    expect(record?.properties?.Line).toMatchObject({
      optional: true,
      items: {
        properties: {
          SalesItemLineDetail: { optional: true },
          AccountBasedExpenseLineDetail: { optional: true },
          ItemBasedExpenseLineDetail: { optional: true },
        },
      },
    })
    expect(record?.properties?.Id.optional).not.toBe(true)
    expect(record?.properties?.CustomerRef.optional).toBe(true)
  })
})

describe('QuickBooks attachment metadata reads', () => {
  const requestUrl = quickbooksReadAttachmentsTool.request.url as (
    params: QuickBooksReadAttachmentsParams
  ) => string

  it('constructs one fixed, escaped Attachable list query with bounded pagination', () => {
    const url = new URL(
      requestUrl({
        ...auth,
        readMode: 'list',
        targetType: 'invoice',
        targetId: " 12'34 ",
        startPosition: 2,
        maxResults: 100,
      })
    )
    expect(url.pathname).toBe('/v3/company/123456789/query')
    expect(url.searchParams.get('query')).toBe(
      "SELECT * FROM Attachable WHERE AttachableRef.EntityRef.Type = 'Invoice' AND AttachableRef.EntityRef.value = '12\\'34' STARTPOSITION 2 MAXRESULTS 100"
    )
  })

  it('reads attachment metadata by an encoded ID', () => {
    const url = new URL(requestUrl({ ...auth, readMode: 'by_id', attachmentId: ' A/B ' }))
    expect(url.pathname).toBe('/v3/company/123456789/attachable/A%2FB')
  })

  it('returns a valid empty page and native by-ID metadata', async () => {
    const listParams: QuickBooksReadAttachmentsParams = {
      ...auth,
      readMode: 'list',
      targetType: 'invoice',
      targetId: '12',
      startPosition: 1,
      maxResults: 25,
    }
    await expect(
      quickbooksReadAttachmentsTool.transformResponse!(
        Response.json({ QueryResponse: {}, time: 'test-time' }),
        listParams
      )
    ).resolves.toMatchObject({ output: { items: [], hasMore: false, time: 'test-time' } })
    await expect(
      quickbooksReadAttachmentsTool.transformResponse!(
        Response.json({
          Attachable: { Id: '9', FileName: 'receipt.pdf', Size: 12 },
          time: 'test-time',
        }),
        { ...auth, readMode: 'by_id', attachmentId: '9' }
      )
    ).resolves.toMatchObject({ output: { item: { Id: '9', FileName: 'receipt.pdf' } } })
  })

  it('preserves a populated attachment page and rejects malformed wrappers', async () => {
    const params: QuickBooksReadAttachmentsParams = {
      ...auth,
      readMode: 'list',
      targetType: 'bill',
      targetId: '88',
      startPosition: 4,
      maxResults: 2,
    }
    await expect(
      quickbooksReadAttachmentsTool.transformResponse!(
        Response.json({
          QueryResponse: {
            Attachable: [{ Id: '10', FileName: 'receipt.pdf', ContentType: 'application/pdf' }],
            startPosition: 4,
            maxResults: 1,
          },
          time: 'test-time',
        }),
        params
      )
    ).resolves.toMatchObject({
      output: {
        items: [{ Id: '10', FileName: 'receipt.pdf' }],
        startPosition: 4,
        maxResults: 1,
        nextStartPosition: 5,
        hasMore: false,
      },
    })
    await expect(
      quickbooksReadAttachmentsTool.transformResponse!(Response.json({}), params)
    ).rejects.toThrow('missing QueryResponse')
    expect(() => requestUrl({ ...params, maxResults: 101 })).toThrow('from 1 through 100')
  })

  it('reads upload timestamps from the nested AttachableResponse wrapper', async () => {
    const response = new Response(
      JSON.stringify({
        AttachableResponse: [{ Attachable: { Id: '9' }, time: '2026-08-02T12:00:00Z' }],
      })
    )

    await expect(parseQuickBooksAttachableResponse(response)).resolves.toEqual({
      attachment: { Id: '9' },
      time: '2026-08-02T12:00:00Z',
    })
  })

  it('removes Intuit attachment access URLs from parsed and listed metadata', async () => {
    const attachment = {
      Id: '9',
      FileName: 'receipt.pdf',
      FileAccessUri: 'https://example.invalid/file',
      TempDownloadUri: 'https://example.invalid/temp?token=secret',
      TemporaryDownloadUri: 'https://example.invalid/temporary?token=secret',
      ThumbnailFileAccessUri: 'https://example.invalid/thumbnail',
      ThumbnailTempDownloadUri: 'https://example.invalid/thumbnail-temp?token=secret',
    }

    expect(sanitizeQuickBooksAttachable(attachment)).toEqual({
      Id: '9',
      FileName: 'receipt.pdf',
    })

    await expect(
      parseQuickBooksAttachableResponse(Response.json({ Attachable: attachment }))
    ).resolves.toEqual({
      attachment: { Id: '9', FileName: 'receipt.pdf' },
      time: null,
    })

    const params: QuickBooksReadAttachmentsParams = {
      ...auth,
      readMode: 'list',
      targetType: 'invoice',
      targetId: '88',
    }
    await expect(
      quickbooksReadAttachmentsTool.transformResponse!(
        Response.json({ QueryResponse: { Attachable: [attachment] } }),
        params
      )
    ).resolves.toMatchObject({
      output: { items: [{ Id: '9', FileName: 'receipt.pdf' }] },
    })
  })

  it('surfaces sanitized faults from successful upload envelopes', async () => {
    const response = Response.json({
      AttachableResponse: [
        {
          Fault: {
            Error: [
              {
                Message: 'Invalid Uploaded File',
                Detail: 'The uploaded file is invalid',
                code: '6041',
              },
            ],
          },
        },
      ],
    })

    await expect(parseQuickBooksAttachableResponse(response)).rejects.toThrow(
      '6041: Invalid Uploaded File: The uploaded file is invalid'
    )
  })

  it('rejects unsupported targets and modes before fetch', () => {
    expect(() =>
      requestUrl({ ...auth, readMode: 'list', targetType: 'unknown' as never, targetId: '1' })
    ).toThrow('attachment target type')
    expect(() => requestUrl({ ...auth, readMode: 'other' as never })).toThrow('read mode')
  })
})

describe('QuickBooks document validation and block parity', () => {
  it('sanitizes filenames and validates the fixed MIME/extension allowlist', () => {
    expect(sanitizeQuickBooksFileName('../unsafe/receipt?.pdf', 'fallback.pdf')).toBe(
      'receipt_.pdf'
    )
    expect(sanitizeQuickBooksFileName(undefined, '..')).toBe('quickbooks-file')
    expect(sanitizeQuickBooksFileName('\u0000', '../../safe-fallback.pdf')).toBe(
      'safe-fallback.pdf'
    )
    expect(validateQuickBooksAttachmentFileType('receipt.pdf', 'application/pdf')).toBe(
      'application/pdf'
    )
    expect(() => validateQuickBooksAttachmentFileType('scan.tiff', 'image/tiff')).toThrow(
      'does not support'
    )
    expect(() => validateQuickBooksAttachmentFileType('note.rtf', 'application/rtf')).toThrow(
      'does not support'
    )
    expect(() => validateQuickBooksAttachmentFileType('data.xml', 'application/xml')).toThrow(
      'does not support'
    )
    expect(() =>
      validateQuickBooksAttachmentFileType('script.exe', 'application/octet-stream')
    ).toThrow('does not support')
  })

  it('keeps target mappings fixed and rejects arbitrary types', () => {
    expect(getQuickBooksAttachmentTarget('purchase_order')).toEqual({ entityType: 'PurchaseOrder' })
    expect(() => getQuickBooksAttachmentTarget('arbitrary' as never)).toThrow(
      'attachment target type'
    )
  })

  it('keeps internal download route responses as small stored-file metadata', () => {
    expect(quickbooksDownloadTransactionPdfTool.request.maxResponseBytes).toBe(
      QUICKBOOKS_INTERNAL_FILE_RESPONSE_MAX_BYTES
    )
    expect(quickbooksDownloadAttachmentTool.request.maxResponseBytes).toBe(
      QUICKBOOKS_INTERNAL_FILE_RESPONSE_MAX_BYTES
    )
    expect(QUICKBOOKS_INTERNAL_FILE_RESPONSE_MAX_BYTES).toBe(256 * 1024)
  })

  it('forwards trusted execution context only to file download routes', () => {
    const body = quickbooksDownloadTransactionPdfTool.request.body!({
      ...auth,
      transactionType: 'invoice',
      transactionId: '12',
      _context: {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
    })
    expect(body).toMatchObject({
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
  })

  it('exposes exactly 45 operation/tool pairs and a canonical single-file input pair', () => {
    const operation = QuickBooksBlock.subBlocks.find((block) => block.id === 'operation')
    expect(operation?.options).toHaveLength(45)
    expect(QuickBooksBlock.tools?.access).toHaveLength(45)
    expect(new Set(QuickBooksBlock.tools?.access).size).toBe(45)
    expect(operation?.options?.map((option) => option.id).sort()).toEqual(
      [...(QuickBooksBlock.tools?.access ?? [])].sort()
    )
    expect(QuickBooksBlock.outputs?.record.condition).toEqual({
      field: 'operation',
      value: expect.arrayContaining(['quickbooks_email_transaction']),
    })
    const fileBlocks = QuickBooksBlock.subBlocks.filter(
      (block) => block.canonicalParamId === 'attachmentFile'
    )
    expect(fileBlocks.map((block) => block.id)).toEqual([
      'attachmentFileUpload',
      'attachmentFileReference',
    ])
    expect(fileBlocks.every((block) => block.required !== undefined)).toBe(true)
  })

  it('maps document params after dynamic references resolve', () => {
    const mapper = QuickBooksBlock.tools?.config?.params as (
      params: Record<string, unknown>
    ) => Record<string, unknown>
    expect(
      mapper({
        operation: 'quickbooks_email_transaction',
        oauthCredential: 'credential-id',
        documentTransactionType: 'invoice' satisfies QuickBooksDocumentTransactionType,
        documentTransactionId: '12',
        confirmSend: 'yes',
      })
    ).toMatchObject({
      credential: 'credential-id',
      transactionType: 'invoice',
      transactionId: '12',
      confirmSend: true,
    })
  })
})
