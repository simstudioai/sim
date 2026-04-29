import type { NextRequest, NextResponse } from 'next/server'
import {
  mothershipChatGetQuerySchema,
  mothershipChatPostEnvelopeSchema,
} from '@/lib/api/contracts/mothership-tasks'
import { validateSchema } from '@/lib/api/server'
import { handleUnifiedChatPost, maxDuration } from '@/lib/copilot/chat/post'
import { GET as copilotChatGet } from '@/app/api/copilot/chat/queries'

export { maxDuration }

// Unified chat route surface.
export function GET(request: NextRequest) {
  const validation = validateSchema(
    mothershipChatGetQuerySchema,
    Object.fromEntries(request.nextUrl.searchParams.entries())
  )
  if (!validation.success) return validation.response as NextResponse

  return copilotChatGet(request)
}

export async function POST(request: NextRequest) {
  const body = await request
    .clone()
    .json()
    .catch(() => undefined)
  if (body !== undefined) {
    const validation = validateSchema(
      mothershipChatPostEnvelopeSchema,
      body,
      'Invalid request body'
    )
    if (!validation.success) {
      return validation.response
    }
  }

  return handleUnifiedChatPost(request)
}
