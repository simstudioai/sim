import { type NextRequest, NextResponse } from 'next/server'
import {
  abortWorkspaceFileUploadContract,
  getWorkspaceFileUploadContract,
} from '@/lib/api/contracts/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { abortUploadSession, getOwnedUploadSession } from '@/lib/uploads/multipart-session/service'
import {
  requireUploadUser,
  requireWorkspaceWrite,
  uploadSessionErrorResponse,
} from '@/app/api/files/uploads/utils'
import { toV2FileUpload } from '@/app/api/v2/files/uploads/utils'

interface UploadRouteParams {
  params: Promise<{ uploadId: string }>
}

export const GET = withRouteHandler(async (request: NextRequest, context: UploadRouteParams) => {
  const user = await requireUploadUser()
  if (user instanceof NextResponse) return user
  const parsed = await parseRequest(getWorkspaceFileUploadContract, request, context)
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
    const file = upload.completedFileId
      ? await getWorkspaceFile(workspaceId, upload.completedFileId, { throwOnError: true })
      : null
    return NextResponse.json({ data: toV2FileUpload(upload, file) })
  } catch (error) {
    const classified = uploadSessionErrorResponse(error)
    if (classified) return classified
    throw error
  }
})

export const DELETE = withRouteHandler(async (request: NextRequest, context: UploadRouteParams) => {
  const user = await requireUploadUser()
  if (user instanceof NextResponse) return user
  const parsed = await parseRequest(abortWorkspaceFileUploadContract, request, context)
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
    return NextResponse.json({ data: toV2FileUpload(await abortUploadSession(upload), null) })
  } catch (error) {
    const classified = uploadSessionErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
