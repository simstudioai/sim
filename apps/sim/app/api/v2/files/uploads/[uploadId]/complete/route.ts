import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2CompleteFileUploadContract } from '@/lib/api/contracts/v2/files'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getWorkspaceFile, registerUploadedWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import {
  completeUploadSession,
  getOwnedUploadSession,
} from '@/lib/uploads/multipart-session/service'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2FileUpload } from '@/app/api/v2/files/uploads/utils'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CaughtOrchestrationError,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2CompleteFileUploadAPI')

interface FileUploadRouteParams {
  params: Promise<{ uploadId: string }>
}

export const POST = withRouteHandler(
  async (request: NextRequest, context: FileUploadRouteParams) => {
    try {
      const rateLimit = await checkRateLimit(request, 'files')
      if (!rateLimit.allowed) return v2RateLimitError(rateLimit)
      const userId = rateLimit.userId!
      const gate = await v2ApiGateError(userId)
      if (gate) return gate
      const parsed = await parseRequest(v2CompleteFileUploadContract, request, context, {
        validationErrorResponse: v2ValidationError,
      })
      if (!parsed.success) return parsed.response
      const { uploadId } = parsed.data.params
      const { workspaceId } = parsed.data.query
      const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
      if (access) return v2WorkspaceAccessError(access)
      const session = await getOwnedUploadSession({ uploadId, workspaceId, userId })
      const metadata = session.metadata as { folderId?: string | null }
      const result = await completeUploadSession({
        session,
        parts: parsed.data.body.parts,
        finalize: async (claimed) => {
          const registered = await registerUploadedWorkspaceFile({
            workspaceId,
            userId,
            key: claimed.storageKey,
            originalName: claimed.fileName,
            contentType: claimed.contentType,
            folderId: metadata.folderId,
          })
          return { value: registered.file.id, completedFileId: registered.file.id }
        },
      })
      const fileId = result.value ?? result.session.completedFileId
      if (!fileId) throw new Error('Completed upload is missing its workspace file id')
      const file = await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
      if (!file) throw new Error(`Completed workspace file ${fileId} not found`)

      if (!result.alreadyCompleted) {
        recordAudit({
          workspaceId,
          actorId: userId,
          action: AuditAction.FILE_UPLOADED,
          resourceType: AuditResourceType.FILE,
          resourceId: file.id,
          resourceName: file.name,
          description: `Uploaded file "${file.name}" via API`,
          metadata: { fileSize: file.size, fileType: file.type },
          request,
        })
      }
      return v2Data(toV2FileUpload(result.session, file), { rateLimit })
    } catch (error) {
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified
      logger.error('Failed to complete file upload', { error: getErrorMessage(error) })
      return v2Error('INTERNAL_ERROR', 'Internal server error')
    }
  }
)
