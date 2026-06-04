import type { NextRequest, NextResponse } from 'next/server'
import { mothershipChatResourceEnvelopeSchema } from '@/lib/api/contracts/mothership-tasks'
import { validationErrorResponse } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  DELETE as copilotResourcesDelete,
  PATCH as copilotResourcesPatch,
  POST as copilotResourcesPost,
} from '@/app/api/copilot/chat/resources/route'

async function validateResourceRequestEnvelope(request: NextRequest): Promise<NextResponse | null> {
  // boundary-raw-json: shim pre-validates the mothership envelope before delegating to the copilot handler that consumes the body
  const body = await request
    .clone()
    .json()
    .catch(() => undefined)
  if (body !== undefined) {
    const validation = mothershipChatResourceEnvelopeSchema.safeParse(body)
    if (!validation.success) return validationErrorResponse(validation.error)
  }
  return null
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const validationResponse = await validateResourceRequestEnvelope(request)
  if (validationResponse) return validationResponse

  return copilotResourcesPost(request, undefined)
})

export const PATCH = withRouteHandler(async (request: NextRequest) => {
  const validationResponse = await validateResourceRequestEnvelope(request)
  if (validationResponse) return validationResponse

  return copilotResourcesPatch(request, undefined)
})

export const DELETE = withRouteHandler(async (request: NextRequest) => {
  const validationResponse = await validateResourceRequestEnvelope(request)
  if (validationResponse) return validationResponse

  return copilotResourcesDelete(request, undefined)
})
