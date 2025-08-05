import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { pollOutlookWebhooks } from '@/lib/webhooks/outlook-polling-service'

const logger = createLogger('OutlookPollingTestAPI')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    logger.info('Manual Outlook webhook polling test triggered')

    const results = await pollOutlookWebhooks()

    return NextResponse.json({
      success: true,
      message: 'Outlook polling test completed',
      ...results,
    })
  } catch (error) {
    logger.error('Error during Outlook polling test:', error)
    return NextResponse.json(
      {
        success: false,
        message: 'Outlook polling test failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
