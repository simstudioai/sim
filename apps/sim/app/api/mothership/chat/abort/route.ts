import type { NextRequest } from 'next/server'
import { mothershipChatAbortEnvelopeSchema } from '@/lib/api/contracts/mothership-tasks'
import { validateSchema } from '@/lib/api/server'
import { POST as copilotAbortPost } from '@/app/api/copilot/chat/abort/route'

export async function POST(request: NextRequest) {
  const body = await request
    .clone()
    .json()
    .catch(() => undefined)
  if (body !== undefined) {
    const validation = validateSchema(
      mothershipChatAbortEnvelopeSchema,
      body,
      'Invalid request body'
    )
    if (!validation.success) {
      return validation.response
    }
  }

  return copilotAbortPost(request, undefined)
}
