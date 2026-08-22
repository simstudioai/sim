import { type NextRequest, NextResponse } from 'next/server'
import { createInternalFileUploadPartUrlsContract } from '@/lib/api/contracts/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { issueInternalUploadPartUrls } from '@/lib/uploads/upload-session/application'
import { requireUploadUser, uploadSessionErrorResponse } from '@/app/api/files/uploads/utils'

interface UploadRouteParams {
  params: Promise<{ uploadId: string }>
}

export const POST = withRouteHandler(async (request: NextRequest, context: UploadRouteParams) => {
  const actor = await requireUploadUser()
  if (actor instanceof NextResponse) return actor
  const parsed = await parseRequest(createInternalFileUploadPartUrlsContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const parts = await issueInternalUploadPartUrls(
      actor.principal,
      {
        uploadId: parsed.data.params.uploadId,
        uploadToken: parsed.data.headers['upload-token'],
        partNumbers: parsed.data.body.partNumbers,
      },
      request
    )
    return NextResponse.json({ data: parts })
  } catch (error) {
    const classified = uploadSessionErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
