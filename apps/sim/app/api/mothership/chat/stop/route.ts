import type { NextRequest } from 'next/server'
import { mothershipChatStopEnvelopeSchema } from '@/lib/api/contracts/mothership-tasks'
import { validationErrorResponse } from '@/lib/api/server'
import { POST as copilotStopPost } from '@/app/api/copilot/chat/stop/route'

// Unified stop route surface.
export async function POST(request: NextRequest) {
  const body = await request
    .clone()
    .json()
    .catch(() => undefined)
  if (body !== undefined) {
    const validation = mothershipChatStopEnvelopeSchema.safeParse(body)
    if (!validation.success) return validationErrorResponse(validation.error)
  }

  return copilotStopPost(request, undefined)
}
