import { type NextRequest, NextResponse } from 'next/server'
import { createInternalFileUploadPartUrlsContract } from '@/lib/api/contracts/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createUploadPartUrls, getOwnedUploadSession } from '@/lib/uploads/upload-session/service'
import { reauthorizeUploadPurpose } from '@/app/api/files/uploads/purposes'
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
    const session = await getOwnedUploadSession({
      uploadId: parsed.data.params.uploadId,
      uploadToken: parsed.data.headers['upload-token'],
      userId: actor.id,
    })
    await reauthorizeUploadPurpose(actor.id, session)
    const parts = await createUploadPartUrls({
      session,
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
