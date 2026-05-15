import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { getValidationErrorMessage, isZodError } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import {
  assertSafeExternalUrl,
  extractSapConcurError,
  fetchSapConcurAccessToken,
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
])

const QUICK_EXPENSE_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/tiff',
])

const ALLOWED_MIME_TYPES = RECEIPT_ALLOWED_MIME_TYPES

function inferMimeType(name: string, declared?: string): string {
  if (declared && ALLOWED_MIME_TYPES.has(declared.toLowerCase())) {
    return declared.toLowerCase() === 'image/jpg' ? 'image/jpeg' : declared.toLowerCase()
  }
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff'
  return 'application/octet-stream'
}

function stringifyMaybeJson(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value ?? {})
}

interface UploadInvocation {
  status: number
  body: unknown
}

async function postMultipart(
  url: string,
  accessToken: string,
  formData: FormData,
  companyUuid: string | undefined,
  extraHeaders?: Record<string, string>
): Promise<UploadInvocation> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    ...(extraHeaders ?? {}),
  }
  if (companyUuid) headers['concur-correlationid'] = companyUuid

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
    },
    'apiUrl'
  )

  const raw = await response.text()
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
  return { status: response.status, body: parsed }
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

  const extraHeaders: Record<string, string> | undefined = req.forwardId
    ? { 'concur-forwardid': req.forwardId }
    : undefined

  return postMultipart(url, accessToken, formData, req.companyUuid, extraHeaders)
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

  return postMultipart(url, accessToken, formData, req.companyUuid)
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
    const fileBuffer = await downloadFileFromStorage(userFile, requestId, logger)
    const fileName = userFile.name
    const mimeType = inferMimeType(fileName, userFile.type)

    const allowedForOperation =
      uploadReq.operation === 'create_quick_expense_with_image'
        ? QUICK_EXPENSE_ALLOWED_MIME_TYPES
        : RECEIPT_ALLOWED_MIME_TYPES
    if (!allowedForOperation.has(mimeType)) {
      const allowedLabel =
        uploadReq.operation === 'create_quick_expense_with_image'
          ? 'pdf, png, jpeg, tiff'
          : 'pdf, png, jpeg, gif, tiff'
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported receipt mime type: ${mimeType}. Allowed: ${allowedLabel}`,
        },
        { status: 400 }
      )
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
      return NextResponse.json({ success: true, output: { status: invocation.status, data } })
    }

    const message = extractSapConcurError(invocation.body, invocation.status)
    logger.warn(
      `[${requestId}] Concur upload error (${invocation.status}) ${uploadReq.operation}: ${message}`
    )
    return NextResponse.json(
      { success: false, error: message, status: invocation.status },
      { status: invocation.status }
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
    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
