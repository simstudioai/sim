import { type NextRequest, NextResponse } from 'next/server'
import { createInternalFileUploadContract } from '@/lib/api/contracts/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createPurposeUploadSession } from '@/app/api/files/uploads/purposes'
import {
  requireUploadUser,
  toInternalUploadSession,
  uploadSessionErrorResponse,
} from '@/app/api/files/uploads/utils'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const actor = await requireUploadUser()
  if (actor instanceof NextResponse) return actor
  const parsed = await parseRequest(createInternalFileUploadContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    const created = await createPurposeUploadSession(
      actor.id,
      parsed.data.body,
      request.nextUrl.origin
    )
    return NextResponse.json(
      {
        data: {
          session: toInternalUploadSession(created, null),
          uploadToken: created.uploadToken,
          transfer: created.transfer,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    const classified = uploadSessionErrorResponse(error)
    if (classified) return classified
    throw error
  }
})
