import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { QUICKBOOKS_MAX_RESPONSE_BYTES } from '@/tools/quickbooks/client'
import { formatQuickBooksFaultDetail, sanitizeQuickBooksFaultData } from '@/tools/quickbooks/fault'
import type {
  QuickBooksAttachable,
  QuickBooksAttachmentTargetType,
  QuickBooksDocumentTransactionType,
} from '@/tools/quickbooks/types'
import { parseQuickBooksJson } from '@/tools/quickbooks/utils'
import { requiredQuickBooksString } from '@/tools/quickbooks/values'

export const QUICKBOOKS_DOCUMENT_TRANSACTIONS = {
  credit_memo: { entity: 'CreditMemo', resource: 'creditmemo' },
  estimate: { entity: 'Estimate', resource: 'estimate' },
  invoice: { entity: 'Invoice', resource: 'invoice' },
  payment: { entity: 'Payment', resource: 'payment' },
  purchase_order: { entity: 'PurchaseOrder', resource: 'purchaseorder' },
  refund_receipt: { entity: 'RefundReceipt', resource: 'refundreceipt' },
  sales_receipt: { entity: 'SalesReceipt', resource: 'salesreceipt' },
} as const satisfies Record<QuickBooksDocumentTransactionType, { entity: string; resource: string }>

export const QUICKBOOKS_ATTACHMENT_TARGETS = {
  bill: { entityType: 'Bill', queryEntityType: 'bill' },
  bill_payment: { entityType: 'BillPayment', queryEntityType: 'billpayment' },
  credit_memo: { entityType: 'CreditMemo', queryEntityType: 'creditmemo' },
  deposit: { entityType: 'Deposit', queryEntityType: 'deposit' },
  estimate: { entityType: 'Estimate', queryEntityType: 'estimate' },
  invoice: { entityType: 'Invoice', queryEntityType: 'invoice' },
  item: { entityType: 'Item', queryEntityType: 'item' },
  journal_entry: { entityType: 'JournalEntry', queryEntityType: 'journalentry' },
  payment: { entityType: 'Payment', queryEntityType: 'payment' },
  purchase: { entityType: 'Purchase', queryEntityType: 'purchase' },
  purchase_order: { entityType: 'PurchaseOrder', queryEntityType: 'purchaseorder' },
  refund_receipt: { entityType: 'RefundReceipt', queryEntityType: 'refundreceipt' },
  sales_receipt: { entityType: 'SalesReceipt', queryEntityType: 'salesreceipt' },
  vendor_credit: { entityType: 'VendorCredit', queryEntityType: 'vendorcredit' },
} as const satisfies Record<
  QuickBooksAttachmentTargetType,
  { entityType: string; queryEntityType: string }
>

/**
 * Sim intentionally caps each attachment at 20 MB to bound memory use. This is
 * below Intuit's documented 100 MB overall multipart request ceiling.
 * @see https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/attachable
 */
export const QUICKBOOKS_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export const QUICKBOOKS_DOCUMENT_METADATA_TIMEOUT_MS = 15_000
export const QUICKBOOKS_DOCUMENT_TRANSFER_TIMEOUT_MS = 60_000

/**
 * Bounds an outbound Intuit call by both client disconnect and a wall-clock
 * timeout so a stalled connection cannot pin a handler and its buffered file.
 */
export function quickBooksDocumentSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
}

const QUICKBOOKS_OCTET_STREAM = 'application/octet-stream'

interface QuickBooksFileType {
  /** Content type sent to Intuit for this extension. */
  canonical: string
  /** Content types tolerated from browser-supplied stored-file metadata. */
  accepted: readonly string[]
}

/**
 * Extension allowlist for QuickBooks attachments. Each entry follows Intuit's
 * published extension/content-type table, tolerates common browser and OS MIME
 * aliases, and normalizes them to one canonical content type before upload.
 *
 * Sending `image/jpeg` for a `.jpg` file is deliberate and must not be "fixed" back to
 * `image/jpg`. Intuit's Attachable upload sample sends `image/jpg` while the read response for
 * that same file returns `image/jpeg`, so QuickBooks normalizes on ingest; and the
 * `attachablerequest` model has no `ContentType` property at all, which makes the multipart
 * metadata content type advisory rather than contractual.
 */
const QUICKBOOKS_FILE_TYPES: Record<string, QuickBooksFileType> = {
  ai: {
    canonical: 'application/postscript',
    accepted: ['application/postscript', QUICKBOOKS_OCTET_STREAM],
  },
  csv: {
    canonical: 'text/csv',
    accepted: [
      'text/csv',
      'application/csv',
      'text/plain',
      'application/vnd.ms-excel',
      QUICKBOOKS_OCTET_STREAM,
    ],
  },
  doc: {
    canonical: 'application/msword',
    accepted: ['application/msword', 'application/vnd.ms-word', QUICKBOOKS_OCTET_STREAM],
  },
  docx: {
    canonical: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    accepted: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      QUICKBOOKS_OCTET_STREAM,
    ],
  },
  eps: {
    canonical: 'application/postscript',
    accepted: ['application/postscript', QUICKBOOKS_OCTET_STREAM],
  },
  gif: { canonical: 'image/gif', accepted: ['image/gif'] },
  jpeg: { canonical: 'image/jpeg', accepted: ['image/jpeg', 'image/jpg', 'image/pjpeg'] },
  jpg: { canonical: 'image/jpeg', accepted: ['image/jpeg', 'image/jpg', 'image/pjpeg'] },
  ods: {
    canonical: 'application/vnd.oasis.opendocument.spreadsheet',
    accepted: ['application/vnd.oasis.opendocument.spreadsheet', QUICKBOOKS_OCTET_STREAM],
  },
  pdf: {
    canonical: 'application/pdf',
    accepted: ['application/pdf', 'application/x-pdf', QUICKBOOKS_OCTET_STREAM],
  },
  png: { canonical: 'image/png', accepted: ['image/png', 'image/x-png'] },
  rtf: {
    canonical: 'text/rtf',
    accepted: ['text/rtf', 'application/rtf', QUICKBOOKS_OCTET_STREAM],
  },
  tif: {
    canonical: 'image/tiff',
    accepted: ['image/tiff', 'image/tif', 'image/x-tiff', QUICKBOOKS_OCTET_STREAM],
  },
  tiff: {
    canonical: 'image/tiff',
    accepted: ['image/tiff', 'image/tif', 'image/x-tiff', QUICKBOOKS_OCTET_STREAM],
  },
  txt: {
    canonical: 'text/plain',
    accepted: ['text/plain', QUICKBOOKS_OCTET_STREAM],
  },
  xls: {
    canonical: 'application/vnd.ms-excel',
    accepted: ['application/vnd.ms-excel', 'application/vnd/ms-excel', QUICKBOOKS_OCTET_STREAM],
  },
  xlsx: {
    canonical: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    accepted: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      QUICKBOOKS_OCTET_STREAM,
    ],
  },
  xml: {
    canonical: 'text/xml',
    accepted: ['text/xml', 'application/xml', QUICKBOOKS_OCTET_STREAM],
  },
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

const QUICKBOOKS_MAX_FILE_NAME_LENGTH = 1000

/**
 * Bounds a filename without destroying its extension. Truncating the whole
 * string cuts a long name mid-extension and leaves the file looking
 * extensionless, which every downstream QuickBooks type check then rejects.
 */
function boundQuickBooksFileName(name: string): string {
  if (name.length <= QUICKBOOKS_MAX_FILE_NAME_LENGTH) return name
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex > 0 && dotIndex < name.length - 1) {
    const extension = name.slice(dotIndex)
    const base = name.slice(0, QUICKBOOKS_MAX_FILE_NAME_LENGTH - extension.length).trimEnd()
    if (base) return `${base}${extension}`
  }
  return name.slice(0, QUICKBOOKS_MAX_FILE_NAME_LENGTH)
}

/**
 * Reduces a candidate to one safe filename leaf bounded to the contract's
 * length. Letters and digits in any script survive; path separators, control
 * characters, and every other character collapse to underscores.
 */
export function sanitizeQuickBooksFileName(value: string | undefined, fallback: string): string {
  const sanitize = (candidate: string): string | undefined => {
    const leaf = candidate.trim().split(/[\\/]/).pop() ?? ''
    const cleaned = leaf
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[^\p{L}\p{N}._()\- ]/gu, '_')
      .trim()
    const bounded = boundQuickBooksFileName(cleaned)
    return bounded && bounded !== '.' && bounded !== '..' ? bounded : undefined
  }

  return (value ? sanitize(value) : undefined) ?? sanitize(fallback) ?? 'quickbooks-file'
}

/**
 * Returns the lowercased extension, or an empty string when the name carries none. Splitting on
 * `.` alone would report a dotless name as its own extension, so an unattachable `backup` file
 * would be refused as "the backup file type" instead of as an extensionless one.
 */
function getQuickBooksFileExtension(fileName: string): string {
  const separator = fileName.lastIndexOf('.')
  return separator > 0 ? fileName.slice(separator + 1).toLowerCase() : ''
}

/**
 * Rejects unsupported extensions before any file bytes are read, so an
 * unattachable file never costs a full storage download.
 */
export function assertQuickBooksAttachmentExtension(fileName: string): void {
  const extension = getQuickBooksFileExtension(fileName)
  if (!QUICKBOOKS_FILE_TYPES[extension]) {
    throw new Error(
      `QuickBooks does not support ${extension ? `the ${extension}` : 'an extensionless'} file type`
    )
  }
}

/**
 * Validates an extension/MIME pair and returns the canonical content type that
 * QuickBooks should record for that extension.
 */
export function validateQuickBooksAttachmentFileType(fileName: string, mimeType: string): string {
  const extension = getQuickBooksFileExtension(fileName)
  const normalizedMime = mimeType.split(';', 1)[0].trim().toLowerCase()
  const fileType = QUICKBOOKS_FILE_TYPES[extension]
  if (!fileType || !fileType.accepted.includes(normalizedMime)) {
    throw new Error(
      `QuickBooks does not support the ${extension || 'extensionless'} / ${normalizedMime || 'unknown'} file type combination`
    )
  }
  return fileType.canonical
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

/**
 * Parses an Intuit Attachable envelope for any operation that returns one.
 *
 * `operationLabel` names the operation in the nested-fault error message. It defaults to the
 * upload wording because the upload path is the older caller; every other caller passes its own
 * label so a read failure is not reported as a failed upload.
 */
export async function parseQuickBooksAttachableResponse(
  response: Response,
  signal?: AbortSignal,
  operationLabel = 'attachment upload'
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
      `QuickBooks ${operationLabel} failed: ${formatQuickBooksFaultDetail(sanitizedFault)}`
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

/**
 * Builds the `file_metadata_01` part of an Attachable multipart upload.
 *
 * Intuit's `attachablerequest` model has exactly one free-text field, `Note`, so `description`
 * and `note` both land there and `note` wins when a caller supplies both.
 */
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
      } catch {}
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
