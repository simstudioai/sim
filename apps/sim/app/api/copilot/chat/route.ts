import type { NextRequest, NextResponse } from 'next/server'
import { copilotChatGetQuerySchema } from '@/lib/api/contracts/copilot'
import { validateSchema } from '@/lib/api/server'
import { handleUnifiedChatPost, maxDuration } from '@/lib/copilot/chat/post'
import { GET as getChat } from '@/app/api/copilot/chat/queries'

export { maxDuration }

export const POST = handleUnifiedChatPost

export function GET(request: NextRequest) {
  const queryValidation = validateSchema(
    copilotChatGetQuerySchema,
    Object.fromEntries(new URL(request.url).searchParams)
  )
  if (!queryValidation.success) return queryValidation.response as NextResponse
  return getChat(request)
}
