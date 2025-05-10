import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { checkUsageStatus } from '@/lib/usage-monitor'

const logger = createLogger('UserUsageAPI')

export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user
    const session = await getSession()

    if (!session?.user?.id) {
      logger.warn('Unauthorized usage data access attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get usage data using our monitor utility
    const usageData = await checkUsageStatus(session.user.id)

    // Set appropriate caching headers
    const response = NextResponse.json(usageData)

    // Cache for 5 minutes, private (user-specific data), must revalidate
    response.headers.set('Cache-Control', 'private, max-age=300, must-revalidate')
    // Add date header for age calculation
    response.headers.set('Date', new Date().toUTCString())

    return response
  } catch (error) {
    logger.error('Error checking usage data:', error)
    return NextResponse.json({ error: 'Failed to check usage data' }, { status: 500 })
  }
}
