import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import type {
  WindchillOperationBody,
  WindchillOperationResponse,
} from '@/lib/api/contracts/tools/windchill'
import { windchillOperationContract } from '@/lib/api/contracts/tools/windchill'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import {
  createInternalSessionOrExecutorAuth,
  InternalUnauthenticatedError,
} from '@/lib/api/server/routes'
import { generateRequestId } from '@/lib/core/utils/request'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { sanitizeFileName } from '@/executor/constants'
import type { UserFile } from '@/executor/types'
import {
  encodeWindchillOid,
  normalizeServiceRoot,
  normalizeWindchillDocument,
  normalizeWindchillDocuments,
  sanitizeWindchillError,
} from '@/tools/windchill/utils'
import {
  createWindchillSession,
  downloadWindchillContent,
  resolveWindchillContentUrl,
  uploadWindchillContent,
  WindchillProviderError,
  type WindchillUploadFile,
  windchillDocumentUrl,
  windchillMutationRequest,
} from '@/tools/windchill/utils.server'

export const dynamic = 'force-dynamic'
export const maxDuration = 900

const logger = createLogger('WindchillAPI')
const windchillSessionOrExecutorAuth = createInternalSessionOrExecutorAuth({
  audience: 'sim:windchill',
})

async function authenticateWindchillExecutor(
  request: NextRequest
): Promise<WorkflowExecutionDelegatedPrincipal> {
  const principal = await windchillSessionOrExecutorAuth.authenticate(request, {})
  if (
    principal.kind !== 'delegated' ||
    principal.serviceId !== 'executor' ||
    !('delegationContext' in principal)
  ) {
    throw new InternalUnauthenticatedError('Authentication required')
  }
  return principal
}

type WindchillRouteOutput = Extract<WindchillOperationResponse, { success: true }>['output']
type MutationOperation = Exclude<
  WindchillRouteOutput['operation'],
  | 'windchill_download_attachment'
  | 'windchill_download_primary_content'
  | 'windchill_upload_attachments'
  | 'windchill_upload_primary_content'
>

const BULK_RESULT_OPERATIONS = [
  'windchill_create_documents',
  'windchill_update_documents',
  'windchill_check_out_documents',
  'windchill_check_in_documents',
  'windchill_undo_check_out_documents',
  'windchill_revise_documents',
  'windchill_update_document_security_labels',
] as const satisfies readonly MutationOperation[]

const DELETE_OPERATIONS = [
  'windchill_delete_document',
  'windchill_delete_documents',
] as const satisfies readonly MutationOperation[]

type BulkResultOperation = (typeof BULK_RESULT_OPERATIONS)[number]
type DeleteOperation = (typeof DELETE_OPERATIONS)[number]

function isBulkResultOperation(operation: MutationOperation): operation is BulkResultOperation {
  return BULK_RESULT_OPERATIONS.includes(operation as BulkResultOperation)
}

function isDeleteOperation(operation: MutationOperation): operation is DeleteOperation {
  return DELETE_OPERATIONS.includes(operation as DeleteOperation)
}

function successResponse(output: WindchillRouteOutput) {
  const body = { success: true, output } satisfies WindchillOperationResponse
  return NextResponse.json(body)
}

function failureResponse(error: string, status: number) {
  const body = {
    success: false,
    error: sanitizeWindchillError(error),
  } satisfies WindchillOperationResponse
  return NextResponse.json(body, { status })
}

function documentsById(documentOids: string[]) {
  return documentOids.map((ID) => ({ ID }))
}

/** Keeps the media type and drops any `; charset=...` parameters Windchill cannot use. */
function safeMimeType(value: string | undefined): string {
  const mediaType = value?.split(';', 1)[0]?.trim()
  if (mediaType && /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(mediaType)) {
    return mediaType
  }
  return 'application/octet-stream'
}

function mutationOutput(
  operation: MutationOperation,
  data: unknown,
  fallbackIds: string[]
): WindchillRouteOutput {
  const documents = normalizeWindchillDocuments(data)
  const document = documents[0] ?? normalizeWindchillDocument(data)
  const collectionIds = documents
    .map((item) => item.id)
    .filter((id): id is string => typeof id === 'string')
  const returnedIds =
    document?.id && !collectionIds.includes(document.id)
      ? [document.id, ...collectionIds]
      : collectionIds
  const affectedIds = returnedIds.length > 0 ? returnedIds : fallbackIds
  if (isDeleteOperation(operation)) return { operation, affectedIds: fallbackIds }
  if (isBulkResultOperation(operation)) {
    return {
      operation,
      affectedIds,
      ...(documents.length > 0 ? { documents } : {}),
    }
  }
  return {
    operation,
    affectedIds,
    ...(document ? { document } : {}),
  }
}

async function executeMutation(
  body: Exclude<
    WindchillOperationBody,
    | { operation: 'windchill_download_primary_content' }
    | { operation: 'windchill_upload_primary_content' }
    | { operation: 'windchill_download_attachment' }
    | { operation: 'windchill_upload_attachments' }
  >,
  signal: AbortSignal
): Promise<WindchillRouteOutput> {
  const session = await createWindchillSession(body, signal)
  const root = normalizeServiceRoot(body.baseUrl)

  switch (body.operation) {
    case 'windchill_create_document': {
      const data = await windchillMutationRequest({
        params: body,
        session,
        url: `${root}/DocMgmt/Documents`,
        method: 'POST',
        body: {
          ...(body.attributes ?? {}),
          Name: body.name,
          ...(body.number ? { Number: body.number } : {}),
          ...(body.title ? { Title: body.title } : {}),
          ...(body.description ? { Description: body.description } : {}),
          'Context@odata.bind': `Containers('${encodeWindchillOid(body.containerOid)}')`,
          ...(body.folderOid
            ? { 'Folder@odata.bind': `Folders('${encodeWindchillOid(body.folderOid)}')` }
            : {}),
        },
        signal,
      })
      return mutationOutput(body.operation, data, [])
    }
    case 'windchill_create_documents': {
      const data = await windchillMutationRequest({
        params: body,
        session,
        url: `${root}/DocMgmt/CreateDocuments`,
        method: 'POST',
        body: {
          Documents: body.documents.map((document) => ({
            ...(document.attributes ?? {}),
            Name: document.name,
            ...(document.number ? { Number: document.number } : {}),
            ...(document.title ? { Title: document.title } : {}),
            ...(document.description ? { Description: document.description } : {}),
            'Context@odata.bind': `Containers('${encodeWindchillOid(document.containerOid)}')`,
            ...(document.folderOid
              ? { 'Folder@odata.bind': `Folders('${encodeWindchillOid(document.folderOid)}')` }
              : {}),
          })),
        },
        signal,
      })
      return mutationOutput(body.operation, data, [])
    }
    case 'windchill_update_document': {
      const data = await windchillMutationRequest({
        params: body,
        session,
        url: windchillDocumentUrl(root, body.documentOid),
        method: 'PATCH',
        body: body.attributes,
        signal,
      })
      return mutationOutput(body.operation, data, [body.documentOid])
    }
    case 'windchill_update_common_properties': {
      const data = await windchillMutationRequest({
        params: body,
        session,
        url: `${windchillDocumentUrl(root, body.documentOid)}/PTC.DocMgmt.UpdateCommonProperties`,
        method: 'POST',
        body: { Updates: body.commonProperties },
        signal,
      })
      return mutationOutput(body.operation, data, [body.documentOid])
    }
    case 'windchill_update_documents': {
      const data = await windchillMutationRequest({
        params: body,
        session,
        url: `${root}/DocMgmt/UpdateDocuments`,
        method: 'POST',
        body: {
          Documents: body.documents.map((document) => ({
            ...document.attributes,
            ID: document.id,
          })),
        },
        signal,
      })
      return mutationOutput(
        body.operation,
        data,
        body.documents.map((document) => document.id)
      )
    }
    case 'windchill_delete_document': {
      const data = await windchillMutationRequest({
        params: body,
        session,
        url: windchillDocumentUrl(root, body.documentOid),
        method: 'DELETE',
        signal,
      })
      return mutationOutput(body.operation, data, [body.documentOid])
    }
    case 'windchill_delete_documents': {
      const data = await windchillMutationRequest({
        params: body,
        session,
        url: `${root}/DocMgmt/DeleteDocuments`,
        method: 'POST',
        body: { Documents: documentsById(body.documentOids) },
        signal,
      })
      return mutationOutput(body.operation, data, body.documentOids)
    }
    case 'windchill_check_out_document': {
      const data = await windchillMutationRequest({
        params: body,
        session,
        url: `${windchillDocumentUrl(root, body.documentOid)}/PTC.DocMgmt.CheckOut`,
        method: 'POST',
        body: { ...(body.checkOutNote ? { CheckOutNote: body.checkOutNote } : {}) },
        signal,
      })
      return mutationOutput(body.operation, data, [body.documentOid])
    }
    case 'windchill_check_out_documents': {
      const data = await windchillMutationRequest({
        params: body,
        session,
        url: `${root}/DocMgmt/CheckOutDocuments`,
        method: 'POST',
        body: {
          Documents: documentsById(body.documentOids),
          ...(body.checkOutNote ? { CheckOutNote: body.checkOutNote } : {}),
        },
        signal,
      })
      return mutationOutput(body.operation, data, body.documentOids)
    }
    case 'windchill_check_in_document': {
      const data = await windchillMutationRequest({
        params: body,
        session,
        url: `${windchillDocumentUrl(root, body.documentOid)}/PTC.DocMgmt.CheckIn`,
        method: 'POST',
        body: {
          ...(body.checkInNote ? { CheckInNote: body.checkInNote } : {}),
          ...(body.keepCheckedOut !== undefined ? { KeepCheckedOut: body.keepCheckedOut } : {}),
          ...(body.checkOutNote ? { CheckOutNote: body.checkOutNote } : {}),
        },
        signal,
      })
      return mutationOutput(body.operation, data, [body.documentOid])
    }
    case 'windchill_check_in_documents': {
      const data = await windchillMutationRequest({
        params: body,
        session,
        url: `${root}/DocMgmt/CheckInDocuments`,
        method: 'POST',
        body: {
          Documents: documentsById(body.documentOids),
          ...(body.checkInNote ? { CheckInNote: body.checkInNote } : {}),
          ...(body.keepCheckedOut !== undefined ? { KeepCheckedOut: body.keepCheckedOut } : {}),
          ...(body.checkOutNote ? { CheckOutNote: body.checkOutNote } : {}),
        },
        signal,
      })
      return mutationOutput(body.operation, data, body.documentOids)
    }
    case 'windchill_undo_check_out_document': {
      const data = await windchillMutationRequest({
        params: body,
        session,
        url: `${windchillDocumentUrl(root, body.documentOid)}/PTC.DocMgmt.UndoCheckOut`,
        method: 'POST',
        body: {},
        signal,
      })
      return mutationOutput(body.operation, data, [body.documentOid])
    }
    case 'windchill_undo_check_out_documents': {
      const data = await windchillMutationRequest({
        params: body,
        session,
        url: `${root}/DocMgmt/UndoCheckOutDocuments`,
        method: 'POST',
        body: { Documents: documentsById(body.documentOids) },
        signal,
      })
      return mutationOutput(body.operation, data, body.documentOids)
    }
    case 'windchill_revise_document': {
      const data = await windchillMutationRequest({
        params: body,
        session,
        url: `${windchillDocumentUrl(root, body.documentOid)}/PTC.DocMgmt.Revise`,
        method: 'POST',
        body: { ...(body.versionId ? { VersionId: body.versionId } : {}) },
        signal,
      })
      return mutationOutput(body.operation, data, [body.documentOid])
    }
    case 'windchill_revise_documents': {
      const data = await windchillMutationRequest({
        params: body,
        session,
        url: `${root}/DocMgmt/ReviseDocuments`,
        method: 'POST',
        body: {
          Documents: documentsById(body.documentOids),
        },
        signal,
      })
      return mutationOutput(body.operation, data, body.documentOids)
    }
    case 'windchill_set_lifecycle_state': {
      const data = await windchillMutationRequest({
        params: body,
        session,
        url: `${windchillDocumentUrl(root, body.documentOid)}/PTC.DocMgmt.SetState`,
        method: 'POST',
        body: { State: { Display: body.stateDisplay, Value: body.stateValue } },
        signal,
      })
      return mutationOutput(body.operation, data, [body.documentOid])
    }
    case 'windchill_update_document_security_labels': {
      const data = await windchillMutationRequest({
        params: body,
        session,
        url: `${root}/DocMgmt/EditDocumentsSecurityLabels`,
        method: 'POST',
        body: {
          Documents: body.securityLabelUpdates.map((update) => ({
            ...update.labels,
            ID: update.id,
          })),
        },
        signal,
      })
      return mutationOutput(
        body.operation,
        data,
        body.securityLabelUpdates.map((update) => update.id)
      )
    }
  }
}

async function loadUploadFiles(
  inputs: RawFileInput[],
  userId: string,
  requestId: string
): Promise<WindchillUploadFile[] | NextResponse> {
  let userFiles: UserFile[]
  try {
    userFiles = processFilesToUserFiles(inputs, requestId, logger)
  } catch (error) {
    return failureResponse(getErrorMessage(error, 'Invalid file input'), 400)
  }
  if (userFiles.length !== inputs.length) return failureResponse('Invalid file input', 400)

  const declaredTotal = userFiles.reduce((total, file) => total + file.size, 0)
  if (declaredTotal > MAX_FILE_SIZE) {
    return failureResponse('Combined Windchill upload exceeds the maximum file size', 413)
  }

  const files: WindchillUploadFile[] = []
  let actualTotal = 0
  for (const userFile of userFiles) {
    const denied = await assertToolFileAccess(userFile.key, userId, requestId, logger)
    if (denied) return denied
    try {
      const servable = await downloadServableFileFromStorage(userFile, requestId, logger, {
        maxBytes: MAX_FILE_SIZE - actualTotal,
      })
      actualTotal += servable.buffer.length
      if (actualTotal > MAX_FILE_SIZE) {
        return failureResponse('Combined Windchill upload exceeds the maximum file size', 413)
      }
      files.push({
        name: sanitizeFileName(userFile.name),
        mimeType: safeMimeType(servable.contentType || userFile.type),
        size: servable.buffer.length,
        buffer: servable.buffer,
      })
    } catch (error) {
      const notReady = docNotReadyResponse(error)
      if (notReady) return notReady
      return failureResponse(
        getErrorMessage(error, 'Failed to read uploaded file'),
        isPayloadSizeLimitError(error) ? 413 : 400
      )
    }
  }
  return files
}

function contentDispositionFileName(value: string | null): string | null {
  if (!value) return null
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch {
      return encoded
    }
  }
  return (
    value.match(/filename\s*=\s*"([^"]+)"/i)?.[1] ??
    value.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim() ??
    null
  )
}

async function storeDownloadedFile({
  principal,
  buffer,
  fileName,
  contentType,
}: {
  principal: WorkflowExecutionDelegatedPrincipal
  buffer: Buffer
  fileName: string
  contentType: string
}): Promise<UserFile> {
  const { workflowId, executionId } = principal.delegationContext
  if (executionId) {
    return uploadExecutionFile(
      {
        workspaceId: principal.workspaceId,
        workflowId,
        executionId,
      },
      buffer,
      fileName,
      contentType,
      principal.subjectUserId
    )
  }
  return uploadCopilotFile({
    buffer,
    fileName,
    contentType,
    userId: principal.subjectUserId,
  })
}

async function executeDownload(
  body: Extract<
    WindchillOperationBody,
    | { operation: 'windchill_download_primary_content' }
    | { operation: 'windchill_download_attachment' }
  >,
  principal: WorkflowExecutionDelegatedPrincipal,
  signal: AbortSignal
): Promise<WindchillRouteOutput> {
  const documentUrl = windchillDocumentUrl(body.baseUrl, body.documentOid)
  const contentPath =
    body.operation === 'windchill_download_primary_content'
      ? `${documentUrl}/PrimaryContent`
      : `${documentUrl}/Attachments('${encodeWindchillOid(body.attachmentOid)}')`
  const contentUrl = await resolveWindchillContentUrl({
    params: body,
    contentPath,
    signal,
  })
  const downloaded = await downloadWindchillContent({
    params: body,
    url: contentUrl,
    maxBytes: MAX_FILE_SIZE,
    signal,
  })
  const fallback =
    body.operation === 'windchill_download_primary_content'
      ? 'windchill-primary-content.bin'
      : 'windchill-attachment.bin'
  const fileName = sanitizeFileName(
    body.fileName || contentDispositionFileName(downloaded.contentDisposition) || fallback
  )
  const mimeType = safeMimeType(downloaded.contentType)
  const file = await storeDownloadedFile({
    principal,
    buffer: downloaded.buffer,
    fileName,
    contentType: mimeType,
  })
  return {
    operation: body.operation,
    file: { ...file },
    fileName,
    mimeType,
  }
}

export const POST = withRouteHandler(
  async (request: NextRequest) => {
    const requestId = generateRequestId()
    let principal: WorkflowExecutionDelegatedPrincipal
    try {
      principal = await authenticateWindchillExecutor(request)
    } catch (error) {
      if (error instanceof InternalUnauthenticatedError) {
        return failureResponse(error.message, 401)
      }
      throw error
    }

    const parsed = await parseRequest(
      windchillOperationContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          failureResponse(getValidationErrorMessage(error, 'Invalid Windchill request'), 400),
        invalidJsonResponse: () =>
          failureResponse('Windchill request body must be valid JSON', 400),
        payloadTooLargeResponse: () => failureResponse('Windchill request body is too large', 413),
      }
    )
    if (!parsed.success) return parsed.response
    const body = parsed.data.body

    try {
      if (
        body.operation === 'windchill_download_primary_content' ||
        body.operation === 'windchill_download_attachment'
      ) {
        return successResponse(await executeDownload(body, principal, request.signal))
      }

      if (
        body.operation === 'windchill_upload_primary_content' ||
        body.operation === 'windchill_upload_attachments'
      ) {
        const inputs =
          body.operation === 'windchill_upload_primary_content'
            ? [body.primaryFile]
            : body.attachmentFiles
        const files = await loadUploadFiles(inputs, principal.subjectUserId, requestId)
        if (files instanceof NextResponse) return files
        const uploadedFileNames = await uploadWindchillContent({
          params: body,
          documentOid: body.documentOid,
          files,
          primaryContent: body.operation === 'windchill_upload_primary_content',
          signal: request.signal,
        })
        return successResponse({
          operation: body.operation,
          affectedIds: [body.documentOid],
          uploadedFileNames,
        })
      }

      return successResponse(await executeMutation(body, request.signal))
    } catch (error) {
      logger.error('Windchill operation failed', {
        operation: body.operation,
        error: sanitizeWindchillError(getErrorMessage(error, 'Windchill operation failed')),
      })
      if (error instanceof WindchillProviderError) {
        const status = error.status >= 400 && error.status <= 599 ? error.status : 502
        return failureResponse(error.message, status)
      }
      return failureResponse(
        getErrorMessage(error, 'Windchill operation failed'),
        isPayloadSizeLimitError(error) ? 413 : 500
      )
    }
  },
  {
    unhandledErrorResponse: () => failureResponse('Windchill operation failed', 500),
  }
)
