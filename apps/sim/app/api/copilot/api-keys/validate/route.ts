import { type NextRequest, NextResponse } from 'next/server'
import { checkServerSideUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import { checkInternalApiKey } from '@/lib/copilot/utils'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotApiKeysValidate')

export async function POST(req: NextRequest) {
  try {
    // Authenticate via internal API key header
    const auth = checkInternalApiKey(req)
    if (!auth.success) {
      return new NextResponse(null, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const userId = typeof body?.userId === 'string' ? body.userId : undefined

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    logger.info('[API VALIDATION] Validating usage limit', { userId })

    const { isExceeded, currentUsage, limit } = await checkServerSideUsageLimits(userId)

    logger.info('[API VALIDATION] Usage limit validated', { userId, currentUsage, limit, isExceeded })

    if (isExceeded) {
      logger.info('[API VALIDATION] Usage exceeded', { userId, currentUsage, limit })
      return new NextResponse(null, { status: 402 })
    }

    return new NextResponse(null, { status: 200 })
  } catch (error) {
    logger.error('Error validating usage limit', { error })
    return NextResponse.json({ error: 'Failed to validate usage' }, { status: 500 })
  }
}
