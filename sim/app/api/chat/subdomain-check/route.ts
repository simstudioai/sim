import { NextResponse } from 'next/server'
import { db } from '@/db'
import { getSession } from '@/lib/auth'
import { chat } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('SubdomainCheck')

export async function GET(request: Request) {
  // Check if the user is authenticated
  const session = await getSession()
  if (!session || !session.user) {
    return createErrorResponse('Unauthorized', 401)
  }

  try {
    // Get subdomain from query parameters
    const { searchParams } = new URL(request.url)
    const subdomain = searchParams.get('subdomain')

    if (!subdomain) {
      return createErrorResponse('Missing subdomain parameter', 400)
    }

    // Check if subdomain follows allowed pattern (only lowercase letters, numbers, and hyphens)
    if (!/^[a-z0-9-]+$/.test(subdomain)) {
      return NextResponse.json(
        { 
          available: false, 
          error: 'Invalid subdomain format' 
        }, 
        { status: 400 }
      )
    }

    // Query database to see if subdomain already exists
    const existingDeployment = await db
      .select()
      .from(chat)
      .where(eq(chat.subdomain, subdomain))
      .limit(1)

    // Return availability status
    return createSuccessResponse({ 
      available: existingDeployment.length === 0,
      subdomain
    })
  } catch (error) {
    logger.error('Error checking subdomain availability:', error)
    return createErrorResponse('Failed to check subdomain availability', 500)
  }
} 