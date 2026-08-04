import { type NextRequest, NextResponse } from 'next/server'
import { abortInternalFileUploadContract } from '@/lib/api/contracts/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { abortUploadSession, getOwnedUploadSession } from '@/lib/uploads/upload-session/service'
import { reauthorizeUploadPurpose } from '@/app/api/files/uploads/purposes'
import {
  requireUploadUser,
  toInternalUploadSession,
  uploadSessionErrorResponse,
} from '@/app/api/files/uploads/utils'

interface UploadRouteParams {
  params: Promise<{ uploadId: string }>
}

export const DELETE = withRouteHandler(async (request: NextRequest, context: UploadRouteParams) => {
  const actor = await requireUploadUser()
  if (actor instanceof NextResponse) return actor
  const parsed = await parseRequest(abortInternalFileUploadContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const session = getOwnedUploadSession({
      uploadId: parsed.data.params.uploadId,
      uploadToken: parsed.data.headers['upload-token'],
      userId: actor.id,
    })
    await reauthorizeUploadPurpose(actor.id, session)
    const aborted = await abortUploadSession(session)
    return NextResponse.json({ data: toInternalUploadSession(aborted, null) })
  } catch (error) {
    const classified = uploadSessionErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
