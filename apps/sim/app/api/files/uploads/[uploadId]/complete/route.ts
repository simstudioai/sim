import { type NextRequest, NextResponse } from 'next/server'
import { completeInternalFileUploadContract } from '@/lib/api/contracts/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { completeInternalUploadSession } from '@/lib/uploads/upload-session/application'
import {
  requireUploadUser,
  toInternalUploadSession,
  uploadSessionErrorResponse,
} from '@/app/api/files/uploads/utils'

interface UploadRouteParams {
  params: Promise<{ uploadId: string }>
}

export const POST = withRouteHandler(async (request: NextRequest, context: UploadRouteParams) => {
  const actor = await requireUploadUser()
  if (actor instanceof NextResponse) return actor
  const parsed = await parseRequest(completeInternalFileUploadContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const completed = await completeInternalUploadSession(
      actor.principal,
      {
        uploadId: parsed.data.params.uploadId,
        uploadToken: parsed.data.headers['upload-token'],
        actor,
      },
      request
    )
    return NextResponse.json({
      data: toInternalUploadSession(completed.session, completed.value),
    })
  } catch (error) {
    const classified = uploadSessionErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
