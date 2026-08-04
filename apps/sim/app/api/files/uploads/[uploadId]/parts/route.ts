import { type NextRequest, NextResponse } from 'next/server'
import { createWorkspaceFileUploadPartUrlsContract } from '@/lib/api/contracts/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createUploadPartUrls,
  getOwnedUploadSession,
} from '@/lib/uploads/multipart-session/service'
import {
  requireUploadUser,
  requireWorkspaceWrite,
  uploadSessionErrorResponse,
} from '@/app/api/files/uploads/utils'

interface UploadRouteParams {
  params: Promise<{ uploadId: string }>
}

export const POST = withRouteHandler(async (request: NextRequest, context: UploadRouteParams) => {
  const user = await requireUploadUser()
  if (user instanceof NextResponse) return user
  const parsed = await parseRequest(createWorkspaceFileUploadPartUrlsContract, request, context)
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
    const parts = await createUploadPartUrls({
      session: upload,
      partNumbers: parsed.data.body.partNumbers,
      localOrigin: request.nextUrl.origin,
    })
    return NextResponse.json({ data: { parts } })
  } catch (error) {
    const classified = uploadSessionErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
