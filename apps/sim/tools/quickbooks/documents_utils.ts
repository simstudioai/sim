import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { QUICKBOOKS_MAX_RESPONSE_BYTES } from '@/tools/quickbooks/client'
import { formatQuickBooksFaultDetail, sanitizeQuickBooksFaultData } from '@/tools/quickbooks/fault'
import type {
  QuickBooksAttachable,
  QuickBooksAttachmentTargetType,
  QuickBooksDocumentTransactionType,
} from '@/tools/quickbooks/types'
import { parseQuickBooksJson, requiredQuickBooksString } from '@/tools/quickbooks/utils'

export const QUICKBOOKS_DOCUMENT_TRANSACTIONS = {
  credit_memo: { entity: 'CreditMemo', resource: 'creditmemo' },
  estimate: { entity: 'Estimate', resource: 'estimate' },
  invoice: { entity: 'Invoice', resource: 'invoice' },
  purchase_order: { entity: 'PurchaseOrder', resource: 'purchaseorder' },
  refund_receipt: { entity: 'RefundReceipt', resource: 'refundreceipt' },
  sales_receipt: { entity: 'SalesReceipt', resource: 'salesreceipt' },
} as const satisfies Record<QuickBooksDocumentTransactionType, { entity: string; resource: string }>

export const QUICKBOOKS_ATTACHMENT_TARGETS = {
  bill: { entityType: 'Bill' },
  bill_payment: { entityType: 'BillPayment' },
  credit_memo: { entityType: 'CreditMemo' },
  deposit: { entityType: 'Deposit' },
  estimate: { entityType: 'Estimate' },
  invoice: { entityType: 'Invoice' },
  item: { entityType: 'Item' },
  journal_entry: { entityType: 'JournalEntry' },
  payment: { entityType: 'Payment' },
  purchase: { entityType: 'Purchase' },
  purchase_order: { entityType: 'PurchaseOrder' },
  refund_receipt: { entityType: 'RefundReceipt' },
  sales_receipt: { entityType: 'SalesReceipt' },
  vendor_credit: { entityType: 'VendorCredit' },
} as const satisfies Record<QuickBooksAttachmentTargetType, { entityType: string }>

const QUICKBOOKS_FILE_TYPES: Record<string, readonly string[]> = {
  ai: ['application/postscript'],
  csv: ['text/csv'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  eps: ['application/postscript'],
  gif: ['image/gif'],
  jpeg: ['image/jpeg'],
  jpg: ['image/jpeg', 'image/jpg'],
  ods: ['application/vnd.oasis.opendocument.spreadsheet'],
  pdf: ['application/pdf'],
  png: ['image/png'],
  rtf: ['text/rtf'],
  tif: ['image/tiff'],
  txt: ['text/plain'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  xml: ['text/xml'],
}

export function getQuickBooksDocumentTransaction(type: QuickBooksDocumentTransactionType) {
  const config = QUICKBOOKS_DOCUMENT_TRANSACTIONS[type]
  if (!config) throw new Error(`Unsupported QuickBooks document transaction type: ${String(type)}`)
  return config
}

export function getQuickBooksAttachmentTarget(type: QuickBooksAttachmentTargetType) {
  const config = QUICKBOOKS_ATTACHMENT_TARGETS[type]
  if (!config) throw new Error(`Unsupported QuickBooks attachment target type: ${String(type)}`)
  return config
}

export function validateQuickBooksRecipient(recipient?: string): string | undefined {
  if (recipient === undefined) return undefined
  const normalized = recipient.trim()
  if (!normalized) return undefined
  if (/[,;\r\n]/.test(normalized) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('recipient must be one valid email address')
  }
  return normalized
}

export function sanitizeQuickBooksFileName(value: string | undefined, fallback: string): string {
  const sanitize = (candidate: string): string | undefined => {
    const leaf = candidate.trim().split(/[\\/]/).pop() ?? ''
    const bounded = leaf
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[^\w.() -]/g, '_')
      .trim()
      .slice(0, 180)
    return bounded && bounded !== '.' && bounded !== '..' ? bounded : undefined
  }

  return (value ? sanitize(value) : undefined) ?? sanitize(fallback) ?? 'quickbooks-file'
}

export function validateQuickBooksAttachmentFileType(fileName: string, mimeType: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  const normalizedMime = mimeType.split(';', 1)[0].trim().toLowerCase()
  const accepted = QUICKBOOKS_FILE_TYPES[extension]
  if (!accepted || !accepted.includes(normalizedMime)) {
    throw new Error(
      `QuickBooks does not support the ${extension || 'extensionless'} / ${normalizedMime || 'unknown'} file type combination`
    )
  }
  return normalizedMime
}

export function escapeQuickBooksQueryLiteral(value: string, fieldName: string): string {
  return requiredQuickBooksString(value, fieldName).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export interface QuickBooksAttachableEnvelope {
  Attachable?: QuickBooksAttachable
  AttachableResponse?: Array<{
    Attachable?: QuickBooksAttachable
    Fault?: unknown
    time?: string
  }>
  time?: string
}

/**
 * Removes Intuit-managed attachment URLs before records enter tool outputs or execution logs.
 * These URLs can be short-lived capability links and are not needed by callers because file
 * downloads go through the authenticated Download Attachment operation.
 */
export function sanitizeQuickBooksAttachable(
  attachment: QuickBooksAttachable
): QuickBooksAttachable {
  const {
    FileAccessUri: _fileAccessUri,
    TempDownloadUri: _tempDownloadUri,
    TemporaryDownloadUri: _temporaryDownloadUri,
    ThumbnailFileAccessUri: _thumbnailFileAccessUri,
    ThumbnailTempDownloadUri: _thumbnailTempDownloadUri,
    ...safeAttachment
  } = attachment
  return safeAttachment as QuickBooksAttachable
}

export async function parseQuickBooksAttachableResponse(
  response: Response,
  signal?: AbortSignal
): Promise<{ attachment: QuickBooksAttachable; time: string | null }> {
  const data = await parseQuickBooksJson<QuickBooksAttachableEnvelope>(
    response,
    'QuickBooks Attachable response',
    signal
  )
  const nestedFault = data.AttachableResponse?.find((entry) => entry.Fault)?.Fault
  const sanitizedFault = sanitizeQuickBooksFaultData({ Fault: nestedFault })
  if (sanitizedFault) {
    throw new Error(
      `QuickBooks attachment upload failed: ${formatQuickBooksFaultDetail(sanitizedFault)}`
    )
  }
  const attachment = data.Attachable ?? data.AttachableResponse?.[0]?.Attachable
  if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
    throw new Error('QuickBooks Attachable response is missing a valid attachment')
  }
  if (typeof attachment.Id !== 'string' || !attachment.Id.trim()) {
    throw new Error('QuickBooks Attachable response is missing a valid attachment ID')
  }
  const responseTime = data.time ?? data.AttachableResponse?.[0]?.time
  return {
    attachment: sanitizeQuickBooksAttachable(attachment),
    time: typeof responseTime === 'string' ? responseTime : null,
  }
}

export function buildQuickBooksAttachableMetadata(
  targetType: QuickBooksAttachmentTargetType,
  targetId: string,
  options: { fileName?: string; contentType?: string; description?: string; note?: string }
) {
  const target = getQuickBooksAttachmentTarget(targetType)
  return {
    AttachableRef: [
      {
        EntityRef: {
          type: target.entityType,
          value: requiredQuickBooksString(targetId, 'targetId'),
        },
      },
    ],
    ...(options.fileName ? { FileName: options.fileName } : {}),
    ...(options.contentType ? { ContentType: options.contentType } : {}),
    ...(options.description ? { Note: options.description } : {}),
    ...(options.note ? { Note: options.note } : {}),
  }
}

export function assertSingleQuickBooksFile(file: RawFileInput | undefined): RawFileInput {
  if (!file || typeof file !== 'object' || Array.isArray(file)) {
    throw new Error('Exactly one file is required for a QuickBooks file attachment')
  }
  return file
}

export const QUICKBOOKS_TEMP_URL_MAX_BYTES = 64 * 1024
export const QUICKBOOKS_DOCUMENT_JSON_MAX_BYTES = QUICKBOOKS_MAX_RESPONSE_BYTES
export const QUICKBOOKS_INTERNAL_FILE_RESPONSE_MAX_BYTES = 256 * 1024

export async function getQuickBooksDocumentError(
  response: Response,
  signal?: AbortSignal
): Promise<Error> {
  let detail = ''
  try {
    const text = await readResponseTextWithLimit(response, {
      maxBytes: QUICKBOOKS_TEMP_URL_MAX_BYTES,
      label: 'QuickBooks document error response',
      signal,
    })
    if (text) {
      try {
        const fault = sanitizeQuickBooksFaultData(JSON.parse(text))
        if (fault) detail = formatQuickBooksFaultDetail(fault)
      } catch {
        // Empty, plain-text, and HTML gateway errors intentionally remain opaque.
      }
    }
  } catch {
    detail = 'The error response exceeded the safe size limit.'
  }

  const guidance =
    response.status === 401
      ? 'Reconnect the QuickBooks credential.'
      : response.status === 403
        ? 'Confirm the QuickBooks accounting scope and access to this company.'
        : response.status === 429
          ? 'QuickBooks rate limit reached; retry after the indicated delay.'
          : ''
  const trackingId =
    response.headers.get('intuit_tid') ??
    response.headers.get('intuit-tid') ??
    response.headers.get('x-request-id')
  const retryAfter = response.status === 429 ? response.headers.get('retry-after') : null
  return new Error(
    [
      `QuickBooks request failed with HTTP ${response.status}.`,
      guidance,
      detail,
      trackingId ? `(Intuit tracking ID: ${trackingId})` : '',
      retryAfter ? `(Retry-After: ${retryAfter})` : '',
    ]
      .filter(Boolean)
      .join(' ')
  )
}
