import { type NextRequest, NextResponse } from 'next/server'
import { abortInternalFileUploadContract } from '@/lib/api/contracts/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { abortInternalUploadSession } from '@/lib/uploads/upload-session/application'
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
    const aborted = await abortInternalUploadSession(actor.principal, {
      uploadId: parsed.data.params.uploadId,
      uploadToken: parsed.data.headers['upload-token'],
    })
    return NextResponse.json({ data: toInternalUploadSession(aborted, null) })
  } catch (error) {
    const classified = uploadSessionErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
