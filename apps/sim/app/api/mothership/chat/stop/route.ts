import type { NextRequest } from 'next/server'
import { mothershipChatStopEnvelopeSchema } from '@/lib/api/contracts/mothership-chats'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateShimEnvelope } from '@/lib/mothership/request/http'
import { POST as copilotStopPost } from '@/app/api/copilot/chat/stop/route'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const invalid = await validateShimEnvelope(request, mothershipChatStopEnvelopeSchema)
  if (invalid) return invalid

  return copilotStopPost(request, undefined)
})
