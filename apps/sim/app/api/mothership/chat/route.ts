import { type NextRequest, NextResponse } from 'next/server'
import {
  mothershipChatGetQuerySchema,
  mothershipChatPostEnvelopeSchema,
} from '@/lib/api/contracts/mothership-tasks'
import { validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { handleUnifiedChatPost, maxDuration } from '@/lib/copilot/chat/post'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { GET as copilotChatGet } from '@/app/api/copilot/chat/queries'

export { maxDuration }

// Unified chat route surface.
export const GET = withRouteHandler((request: NextRequest) => {
  const validation = mothershipChatGetQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  )
  if (!validation.success) return validationErrorResponse(validation.error)

  return copilotChatGet(request)
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // boundary-raw-json: shim pre-validates the mothership envelope before delegating to the copilot handler that consumes the body
  const body = await request
    .clone()
    .json()
    .catch(() => undefined)
  if (body !== undefined) {
    const validation = mothershipChatPostEnvelopeSchema.safeParse(body)
    if (!validation.success) return validationErrorResponse(validation.error)
  }

  return handleUnifiedChatPost(request)
})
