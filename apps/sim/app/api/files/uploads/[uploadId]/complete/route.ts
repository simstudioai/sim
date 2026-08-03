import { type NextRequest, NextResponse } from 'next/server'
import { completeWorkspaceFileUploadContract } from '@/lib/api/contracts/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import { getWorkspaceFile, registerUploadedWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import {
  completeUploadSession,
  getOwnedUploadSession,
} from '@/lib/uploads/multipart-session/service'
import {
  requireUploadUser,
  requireWorkspaceWrite,
  uploadSessionErrorResponse,
} from '@/app/api/files/uploads/utils'
import { toV2FileUpload } from '@/app/api/v2/files/uploads/utils'

interface UploadRouteParams {
  params: Promise<{ uploadId: string }>
}

export const POST = withRouteHandler(async (request: NextRequest, context: UploadRouteParams) => {
  const user = await requireUploadUser()
  if (user instanceof NextResponse) return user
  const parsed = await parseRequest(completeWorkspaceFileUploadContract, request, context)
  if (!parsed.success) return parsed.response
  const { workspaceId } = parsed.data.query
  const access = await requireWorkspaceWrite(user, workspaceId)
  if (access) return access
  try {
    const upload = await getOwnedUploadSession({
      uploadId: parsed.data.params.uploadId,
      workspaceId,
      userId: user,
    })
    const metadata = upload.metadata as { folderId?: string | null }
    const completed = await completeUploadSession({
      session: upload,
      parts: parsed.data.body.parts,
      finalize: async (claimed) => {
        const registered = await registerUploadedWorkspaceFile({
          workspaceId,
          userId: user,
          key: claimed.storageKey,
          originalName: claimed.fileName,
          contentType: claimed.contentType,
          folderId: metadata.folderId,
        })
        return { value: registered.file.id, completedFileId: registered.file.id }
      },
    })
    const fileId = completed.value ?? completed.session.completedFileId
    if (!fileId) throw new Error('Completed upload is missing its workspace file id')
    const file = await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
    if (!file) throw new Error(`Completed workspace file ${fileId} not found`)
    if (!completed.alreadyCompleted) await notifyWorkspaceFilesChanged(workspaceId)
    return NextResponse.json({ data: toV2FileUpload(completed.session, file) })
  } catch (error) {
    const classified = uploadSessionErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
