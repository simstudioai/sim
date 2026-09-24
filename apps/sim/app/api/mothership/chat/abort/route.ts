import type { NextRequest } from 'next/server'
import { mothershipChatAbortEnvelopeSchema } from '@/lib/api/contracts/mothership-chats'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateShimEnvelope } from '@/lib/mothership/request/http'
import { POST as copilotAbortPost } from '@/app/api/copilot/chat/abort/route'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const invalid = await validateShimEnvelope(request, mothershipChatAbortEnvelopeSchema)
  if (invalid) return invalid

  return copilotAbortPost(request, undefined)
})
