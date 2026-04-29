import type { NextRequest, NextResponse } from 'next/server'
import { mothershipChatStreamQuerySchema } from '@/lib/api/contracts/mothership-tasks'
import { validateSchema } from '@/lib/api/server'
import { GET as copilotStreamGet, maxDuration } from '@/app/api/copilot/chat/stream/route'

export { maxDuration }

export function GET(request: NextRequest) {
  const validation = validateSchema(
    mothershipChatStreamQuerySchema,
    Object.fromEntries(request.nextUrl.searchParams.entries())
  )
  if (!validation.success) return validation.response as NextResponse

  return copilotStreamGet(request, undefined)
}
