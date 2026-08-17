import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { getValidationErrorMessage, isZodError } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { PayloadSizeLimitError, readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import {
  assertSafeExternalUrl,
  describeSapConcurFetchError,
  extractSapConcurError,
  fetchSapConcurAccessToken,
  forwardedSapConcurHeaders,
  SAP_CONCUR_OUTBOUND_FETCH_TIMEOUT_MS,
  type SapConcurUploadRequest,
  SapConcurUploadRequestSchema,
} from '@/app/api/tools/sap_concur/shared'

export const dynamic = 'force-dynamic'

const logger = createLogger('SapConcurUploadAPI')

type UploadRequest = SapConcurUploadRequest

const RECEIPT_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/tiff',
  'image/tif',
])

const QUICK_EXPENSE_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/tiff',
  'image/tif',
])

const ALLOWED_MIME_TYPES = RECEIPT_ALLOWED_MIME_TYPES

/**
 * Concur's documented ceiling for image-only receipts: Receipts "Supported Image Formats"
 * states "Image size must not exceed 25MB."
 */
const MAX_RECEIPT_IMAGE_BYTES = 25 * 1024 * 1024

/**
 * Concur's documented ceiling for quick-expense images: the Quick Expense v4
 * `fileContent` parameter states "Maximum size 50 MB."
 *
 * A file this large is held in memory more than once on the upload path — the downloaded
 * `Buffer`, the `Blob` copy inside the `FormData`, and the serialized multipart `Buffer`.
 * What bounds that is the `userFile.size` check performed *before* the download, together
 * with the `maxBytes` passed to `downloadServableFileFromStorage`; a file over the cap is
 * rejected without ever being materialized. Keep both checks ahead of the download.
 */
const MAX_QUICK_EXPENSE_IMAGE_BYTES = 50 * 1024 * 1024

function maxImageBytesForOperation(operation: UploadRequest['operation']): number {
  return operation === 'create_quick_expense_with_image'
    ? MAX_QUICK_EXPENSE_IMAGE_BYTES
    : MAX_RECEIPT_IMAGE_BYTES
}

function uploadSizeError(bytes: number, maxBytes: number): NextResponse {
  const sizeMB = (bytes / (1024 * 1024)).toFixed(2)
  const limitMB = Math.round(maxBytes / (1024 * 1024))
  return NextResponse.json(
    {
      success: false,
      error: `File size (${sizeMB}MB) exceeds Concur upload limit of ${limitMB}MB`,
    },
    { status: 400 }
  )
}

/**
 * Map a non-2xx Concur status that cannot be re-emitted as an error status onto 502.
 *
 * With `maxRedirects: 0` a 3xx carrying a `Location` never reaches here — it rejects with
 * "Too many redirects" and is handled in the outer catch. What does reach here is a 3xx
 * *without* a `Location`, and a 304, which is excluded from the redirect handling
 * upstream. Neither is a usable error status to return to the caller.
 */
function clampErrorStatus(status: number): number {
  return status >= 400 ? status : 502
}

/** Sentinel {@link inferMimeType} returns when neither the declared type nor the extension resolves. */
const UNKNOWN_MIME_TYPE = 'application/octet-stream'

function unsupportedMimeTypeError(mimeType: string, allowedLabel: string): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: `Unsupported receipt mime type: ${mimeType}. Allowed: ${allowedLabel}`,
    },
    { status: 400 }
  )
}

/**
 * Non-canonical media types Concur callers commonly declare, mapped to the canonical form
 * the allowlists and the outbound `Blob` type use.
 */
const MIME_TYPE_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/tif': 'image/tiff',
}

function inferMimeType(name: string, declared?: string): string {
  if (declared && ALLOWED_MIME_TYPES.has(declared.toLowerCase())) {
    const lowerDeclared = declared.toLowerCase()
    return MIME_TYPE_ALIASES[lowerDeclared] ?? lowerDeclared
  }
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff'
  return UNKNOWN_MIME_TYPE
}

function stringifyMaybeJson(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value ?? {})
}

interface UploadInvocation {
  status: number
  body: unknown
  /** Concur response headers forwarded onto this route's response. */
  headers: Record<string, string>
}

/**
 * POST a multipart body to Concur with the bearer token.
 *
 * `concur-correlationid` is a support/tracing header expected to be a fresh RFC 4122
 * UUID per request; it does not scope a request to a company. Redirects are refused so
 * the Authorization header is never forwarded to another origin.
 *
 * `stripAuthOnRedirect` is unreachable while `maxRedirects` is 0 — no redirect is ever
 * followed for it to act on. It is kept as defense-in-depth so raising `maxRedirects`
 * later cannot silently start forwarding the bearer token; do not remove it as dead code.
 */
/**
 * Read a Concur upload response body under the shared byte cap.
 *
 * On a success status the body is the result, so a cap breach or a stream
 * failure is a real error and must propagate — swallowing it would report an
 * incomplete exchange as a successful upload with no data.
 *
 * On an error status the body only supplies the message, and the upstream
 * status is the more important signal: letting a failed read throw here would
 * surface Concur's 4xx as a Sim 500 and invite a retry the caller should not
 * make. The status is preserved and the message falls back to the generic
 * HTTP-status form from {@link extractSapConcurError}.
 */
export async function readConcurUploadBody(response: {
  status: number
  headers?: { get(name: string): string | null }
  body?: ReadableStream<Uint8Array> | null
  arrayBuffer?: () => Promise<ArrayBuffer>
  text?: () => Promise<string>
}): Promise<string> {
  const read = readResponseTextWithLimit(response, {
    maxBytes: MAX_JSON_API_RESPONSE_BYTES,
    label: 'Concur upload response',
  })
  if (response.status >= 200 && response.status < 300) return read
  return read.catch(() => '')
}

async function postMultipart(
  url: string,
  accessToken: string,
  formData: FormData
): Promise<UploadInvocation> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'concur-correlationid': generateId(),
  }

  // Serialize FormData (with auto-generated multipart boundary) to a Buffer so we can
  // route through secureFetchWithValidation (which doesn't support FormData bodies directly).
  const serialized = new Request('http://localhost/internal-multipart-serializer', {
    method: 'POST',
    body: formData,
  })
  const contentType = serialized.headers.get('content-type')
  if (contentType) headers['Content-Type'] = contentType
  const bodyBuffer = Buffer.from(await serialized.arrayBuffer())

  const response = await secureFetchWithValidation(
    url,
    {
      method: 'POST',
      headers,
      body: bodyBuffer,
      timeout: SAP_CONCUR_OUTBOUND_FETCH_TIMEOUT_MS,
      maxRedirects: 0,
      stripAuthOnRedirect: true,
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
    },
    'apiUrl'
  )

  const raw = await readConcurUploadBody(response)
  let parsed: unknown = null
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = raw
    }
  }
  // Surface Location/Link headers for receipt endpoints that return 202 with no body.
  if (
    parsed === null ||
    (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length === 0)
  ) {
    const location = response.headers.get('Location')
    const link = response.headers.get('Link')
    if (location || link) {
      parsed = { location, link }
    }
  }
  return {
    status: response.status,
    body: parsed,
    headers: forwardedSapConcurHeaders(response.headers),
  }
}

async function handleUploadReceiptImage(
  req: UploadRequest,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  accessToken: string,
  geolocation: string
): Promise<UploadInvocation> {
  const url = assertSafeExternalUrl(
    `${geolocation.replace(/\/+$/, '')}/receipts/v4/users/${encodeURIComponent(req.userId)}/image-only-receipts`,
    'apiUrl'
  ).toString()

  const formData = new FormData()
  formData.append('image', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), fileName)

  return postMultipart(url, accessToken, formData)
}

async function handleCreateQuickExpenseWithImage(
  req: UploadRequest,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  accessToken: string,
  geolocation: string
): Promise<UploadInvocation> {
  const contextType = req.contextType?.trim() || 'TRAVELER'
  const url = assertSafeExternalUrl(
    `${geolocation.replace(/\/+$/, '')}/quickexpense/v4/users/${encodeURIComponent(
      req.userId
    )}/context/${encodeURIComponent(contextType)}/quickexpenses/image`,
    'apiUrl'
  ).toString()

  const quickExpenseRequest = stringifyMaybeJson(req.body ?? {})

  const formData = new FormData()
  formData.append('quickExpenseRequest', quickExpenseRequest)
  formData.append(
    'fileContent',
    new Blob([new Uint8Array(fileBuffer)], { type: mimeType }),
    fileName
  )

  return postMultipart(url, accessToken, formData)
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Concur upload request: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }
    const userId = authResult.userId

    // boundary-raw-json: internal upload envelope validated by SapConcurUploadRequestSchema below; not a public boundary
    const json = await request.json()
    const uploadReq = SapConcurUploadRequestSchema.parse(json)

    const userFiles = processFilesToUserFiles(
      [uploadReq.receipt as RawFileInput],
      requestId,
      logger
    )
    if (userFiles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid receipt file input' },
        { status: 400 }
      )
    }
    const userFile = userFiles[0]
    const denied = await assertToolFileAccess(userFile.key, userId, requestId, logger)
    if (denied) return denied

    const maxBytes = maxImageBytesForOperation(uploadReq.operation)
    const allowedForOperation =
      uploadReq.operation === 'create_quick_expense_with_image'
        ? QUICK_EXPENSE_ALLOWED_MIME_TYPES
        : RECEIPT_ALLOWED_MIME_TYPES
    const allowedLabel =
      uploadReq.operation === 'create_quick_expense_with_image'
        ? 'pdf, png, jpeg, tiff'
        : 'pdf, png, jpeg, gif, tiff'

    if (userFile.size > maxBytes) {
      return uploadSizeError(userFile.size, maxBytes)
    }

    const declaredMimeType = inferMimeType(userFile.name, userFile.type)
    if (declaredMimeType !== UNKNOWN_MIME_TYPE && !allowedForOperation.has(declaredMimeType)) {
      return unsupportedMimeTypeError(declaredMimeType, allowedLabel)
    }

    let fileBuffer: Buffer
    let resolvedContentType: string
    try {
      const resolved = await downloadServableFileFromStorage(userFile, requestId, logger, {
        maxBytes,
      })
      fileBuffer = resolved.buffer
      resolvedContentType = resolved.contentType
    } catch (error) {
      const notReady = docNotReadyResponse(error)
      if (notReady) return notReady
      if (error instanceof PayloadSizeLimitError) {
        return uploadSizeError(error.observedBytes ?? userFile.size, maxBytes)
      }
      logger.error(`[${requestId}] Failed to download Concur receipt file:`, error)
      return NextResponse.json(
        { success: false, error: getErrorMessage(error, 'Unknown error') },
        { status: 500 }
      )
    }

    if (fileBuffer.length > maxBytes) {
      return uploadSizeError(fileBuffer.length, maxBytes)
    }

    const fileName = userFile.name
    const mimeType = inferMimeType(fileName, resolvedContentType || userFile.type)
    if (!allowedForOperation.has(mimeType)) {
      return unsupportedMimeTypeError(mimeType, allowedLabel)
    }

    const { accessToken, geolocation } = await fetchSapConcurAccessToken(uploadReq, requestId)

    let invocation: UploadInvocation
    if (uploadReq.operation === 'upload_receipt_image') {
      invocation = await handleUploadReceiptImage(
        uploadReq,
        fileBuffer,
        fileName,
        mimeType,
        accessToken,
        geolocation
      )
    } else {
      invocation = await handleCreateQuickExpenseWithImage(
        uploadReq,
        fileBuffer,
        fileName,
        mimeType,
        accessToken,
        geolocation
      )
    }

    if (invocation.status >= 200 && invocation.status < 300) {
      const data = invocation.status === 204 ? null : invocation.body
      logger.info(
        `[${requestId}] Concur ${uploadReq.operation} succeeded: HTTP ${invocation.status}`
      )
      return NextResponse.json(
        { success: true, output: { status: invocation.status, data } },
        { headers: invocation.headers }
      )
    }

    const message = extractSapConcurError(invocation.body, invocation.status)
    logger.warn(
      `[${requestId}] Concur upload error (${invocation.status}) ${uploadReq.operation}: ${message}`
    )
    return NextResponse.json(
      { success: false, error: message, status: invocation.status },
      { status: clampErrorStatus(invocation.status), headers: invocation.headers }
    )
  } catch (error) {
    if (isZodError(error)) {
      logger.warn(`[${requestId}] Validation error:`, error.issues)
      return NextResponse.json(
        { success: false, error: getValidationErrorMessage(error, 'Validation failed') },
        { status: 400 }
      )
    }
    logger.error(`[${requestId}] Unexpected Concur upload error:`, error)
    return NextResponse.json(
      { success: false, error: describeSapConcurFetchError(error) },
      { status: 500 }
    )
  }
})
