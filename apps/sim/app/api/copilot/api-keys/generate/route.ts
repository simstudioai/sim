import { type NextRequest, NextResponse } from 'next/server'
import { generateCopilotApiKeyContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { CopilotApiKeyError, generateCopilotApiKey } from '@/lib/copilot/server/api-keys'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const POST = withRouteHandler(async (req: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(generateCopilotApiKeyContract, req, {})
  if (!parsed.success) return parsed.response

  try {
    const key = await generateCopilotApiKey(session.user.id, parsed.data.body.name)
    return NextResponse.json({ success: true, key }, { status: 201 })
  } catch (error) {
    const status = error instanceof CopilotApiKeyError ? error.upstreamStatus : undefined
    return NextResponse.json(
      { error: 'Failed to generate copilot API key' },
      { status: status ?? 500 }
    )
  }
})
