import { type NextRequest, NextResponse } from 'next/server'
import {
  mothershipChatGetQuerySchema,
  mothershipChatPostEnvelopeSchema,
} from '@/lib/api/contracts/mothership-chats'
import { validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { handleUnifiedChatPost, maxDuration } from '@/lib/mothership/chat/post'
import { validateShimEnvelope } from '@/lib/mothership/request/http'
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

  const invalid = await validateShimEnvelope(request, mothershipChatPostEnvelopeSchema)
  if (invalid) return invalid

  return handleUnifiedChatPost(request)
})
