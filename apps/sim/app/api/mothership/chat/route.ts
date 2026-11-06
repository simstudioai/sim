import { type NextRequest, NextResponse } from 'next/server'
import { mothershipChatPostEnvelopeSchema } from '@/lib/api/contracts/mothership-chats'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { handleUnifiedChatPost } from '@/lib/mothership/chat/post'
import { validateShimEnvelope } from '@/lib/mothership/request/http'

/**
 * Caps this response on serverless hosts only; the Node server bounds nothing with it.
 * The run does not depend on this response: one that ends without a terminal is
 * re-attached through the replay stream.
 */
export const maxDuration = 3600

export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const invalid = await validateShimEnvelope(request, mothershipChatPostEnvelopeSchema)
  if (invalid) return invalid

  return handleUnifiedChatPost(request)
})
