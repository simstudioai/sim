import { NextRequest, NextResponse } from 'next/server'
import { Logger } from '@/lib/logs/console-logger'
import { pollGmailWebhooks } from '@/lib/webhooks/gmail-polling-service'
import { nanoid } from 'nanoid'

const logger = new Logger('GmailPollingEndpoint')

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Allow up to 5 minutes for polling to complete

export async function GET(request: NextRequest) {
  const requestId = nanoid()
  logger.info(`[${requestId}] Gmail webhook polling triggered`)
  
  try {
    // Check for authorization header if provided
    const authHeader = request.headers.get('authorization')
    const webhookSecret = process.env.WEBHOOK_POLLING_SECRET
    
    if (webhookSecret && (!authHeader || authHeader !== `Bearer ${webhookSecret}`)) {
      logger.warn(`[${requestId}] Unauthorized access attempt to Gmail polling endpoint`)
      return new NextResponse('Unauthorized', { status: 401 })
    }
    
    // Run the polling service
    const results = await pollGmailWebhooks()
    
    return NextResponse.json({
      success: true,
      message: 'Gmail webhook polling completed successfully',
      results
    })
  } catch (error) {
    logger.error(`[${requestId}] Error in Gmail webhook polling:`, error)
    
    return NextResponse.json(
      {
        success: false,
        message: 'Gmail webhook polling failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
} 