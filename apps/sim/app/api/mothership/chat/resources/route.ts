import type { NextRequest, NextResponse } from 'next/server'
import { mothershipChatResourceEnvelopeSchema } from '@/lib/api/contracts/mothership-tasks'
import { validationErrorResponse } from '@/lib/api/server'
import {
  DELETE as copilotResourcesDelete,
  PATCH as copilotResourcesPatch,
  POST as copilotResourcesPost,
} from '@/app/api/copilot/chat/resources/route'

async function validateResourceRequestEnvelope(request: NextRequest): Promise<NextResponse | null> {
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

export async function POST(request: NextRequest) {
  const validationResponse = await validateResourceRequestEnvelope(request)
  if (validationResponse) return validationResponse

  return copilotResourcesPost(request, undefined)
}

export async function PATCH(request: NextRequest) {
  const validationResponse = await validateResourceRequestEnvelope(request)
  if (validationResponse) return validationResponse

  return copilotResourcesPatch(request, undefined)
}

export async function DELETE(request: NextRequest) {
  const validationResponse = await validateResourceRequestEnvelope(request)
  if (validationResponse) return validationResponse

  return copilotResourcesDelete(request, undefined)
}
