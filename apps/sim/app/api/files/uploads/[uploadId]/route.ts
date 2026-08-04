import { type NextRequest, NextResponse } from 'next/server'
import { abortWorkspaceFileUploadContract } from '@/lib/api/contracts/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
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

export const DELETE = withRouteHandler(async (request: NextRequest, context: UploadRouteParams) => {
  const user = await requireUploadUser()
  if (user instanceof NextResponse) return user
  const parsed = await parseRequest(abortWorkspaceFileUploadContract, request, context)
  if (!parsed.success) return parsed.response
  const { workspaceId } = parsed.data.query
  const access = await requireWorkspaceWrite(user, workspaceId)
  if (access) return access
  try {
    const upload = getOwnedUploadSession({
      uploadId: parsed.data.params.uploadId,
      workspaceId,
      userId: user,
      purpose: 'workspace_file',
      uploadToken: parsed.data.headers['upload-token'],
    })
    return NextResponse.json({ data: toV2FileUpload(await abortUploadSession(upload), null) })
  } catch (error) {
    const classified = uploadSessionErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
