import { type NextRequest, NextResponse } from 'next/server'
import { createInternalFileUploadContract } from '@/lib/api/contracts/upload-sessions'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createInternalPurposeUploadSession } from '@/lib/uploads/upload-session/application'
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
    const created = await createInternalPurposeUploadSession(
      actor.principal,
      parsed.data.body,
      request
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
