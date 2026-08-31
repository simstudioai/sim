import type { NextRequest, NextResponse } from 'next/server'
import { mothershipChatResourceEnvelopeSchema } from '@/lib/api/contracts/mothership-chats'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateShimEnvelope } from '@/lib/mothership/request/http'
import {
  DELETE as copilotResourcesDelete,
  PATCH as copilotResourcesPatch,
  POST as copilotResourcesPost,
} from '@/app/api/copilot/chat/resources/route'

async function validateResourceRequestEnvelope(request: NextRequest): Promise<NextResponse | null> {
  const invalid = await validateShimEnvelope(request, mothershipChatResourceEnvelopeSchema)
  if (invalid) return invalid
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
