import { type NextRequest, NextResponse } from 'next/server'
import { createWorkspaceFileUploadContract } from '@/lib/api/contracts/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { assertWorkspaceFileFolderTarget } from '@/lib/uploads/contexts/workspace'
import { createUploadSession } from '@/lib/uploads/multipart-session/service'
import {
  requireUploadUser,
  requireWorkspaceWrite,
  uploadSessionErrorResponse,
} from '@/app/api/files/uploads/utils'
import { toV2FileUpload } from '@/app/api/v2/files/uploads/utils'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const user = await requireUploadUser()
  if (user instanceof NextResponse) return user
  const parsed = await parseRequest(createWorkspaceFileUploadContract, request, {})
  if (!parsed.success) return parsed.response
  const { workspaceId, name, contentType, size, folderId } = parsed.data.body
  const access = await requireWorkspaceWrite(user, workspaceId)
  if (access) return access
  try {
    const normalizedFolderId = await assertWorkspaceFileFolderTarget(workspaceId, folderId)
    const upload = await createUploadSession({
      workspaceId,
      userId: user,
      purpose: 'workspace_file',
      fileName: name,
      contentType,
      fileSize: size,
      metadata: { folderId: normalizedFolderId },
    })
    return NextResponse.json({ data: toV2FileUpload(upload, null) }, { status: 201 })
  } catch (error) {
    const classified = uploadSessionErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
