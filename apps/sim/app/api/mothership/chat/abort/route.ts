import type { NextRequest } from 'next/server'
import { mothershipChatAbortEnvelopeSchema } from '@/lib/api/contracts/mothership-tasks'
import { validationErrorResponse } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { POST as copilotAbortPost } from '@/app/api/copilot/chat/abort/route'

export const POST = withRouteHandler(async (request: NextRequest) => {
  // boundary-raw-json: shim pre-validates the mothership envelope before delegating to the copilot handler that consumes the body
  const body = await request
    .clone()
    .json()
    .catch(() => undefined)
  if (body !== undefined) {
    const validation = mothershipChatAbortEnvelopeSchema.safeParse(body)
    if (!validation.success) return validationErrorResponse(validation.error)
  }

  return copilotAbortPost(request, undefined)
})
