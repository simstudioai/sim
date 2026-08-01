import { type NextRequest, NextResponse } from 'next/server'
import { deleteCopilotApiKeyQuerySchema } from '@/lib/api/contracts'
import { getSession } from '@/lib/auth'
import {
  CopilotApiKeyError,
  deleteCopilotApiKey,
  listCopilotApiKeys,
} from '@/lib/copilot/server/api-keys'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

function errorResponse(error: unknown, fallback: string): NextResponse {
  const status = error instanceof CopilotApiKeyError ? error.upstreamStatus : undefined
  const message = error instanceof CopilotApiKeyError ? error.message : fallback
  return NextResponse.json({ error: message }, { status: status ?? 500 })
}

export const GET = withRouteHandler(async () => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const keys = await listCopilotApiKeys(session.user.id)
    return NextResponse.json({ keys }, { status: 200 })
  } catch (error) {
    return errorResponse(error, 'Failed to get keys')
  }
})

export const DELETE = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const queryResult = deleteCopilotApiKeyQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  if (!queryResult.success) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  try {
    await deleteCopilotApiKey(session.user.id, queryResult.data.id)
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    return errorResponse(error, 'Failed to delete key')
  }
})
