import type { NextRequest } from 'next/server'
import { copilotChatGetContract } from '@/lib/api/contracts/copilot'
import { parseRequest } from '@/lib/api/server'
import { handleUnifiedChatPost, maxDuration } from '@/lib/copilot/chat/post'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { GET as getChat } from '@/app/api/copilot/chat/queries'

export { maxDuration }

export const POST = handleUnifiedChatPost

export const GET = withRouteHandler(async (request: NextRequest) => {
  const parsed = await parseRequest(copilotChatGetContract, request, {})
  if (!parsed.success) return parsed.response
  return getChat(request)
})
