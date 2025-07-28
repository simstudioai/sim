import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'

export const dynamic = 'force-dynamic'

import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import { chat } from '@/db/schema'

const logger = createLogger('SubdomainValidateAPI')

export async function GET(request: Request) {
  const session = await getSession()
  if (!session || !session.user) {
    return createErrorResponse('Unauthorized', 401)
  }

  try {
    const { searchParams } = new URL(request.url)
    const subdomain = searchParams.get('subdomain')

    if (!subdomain) {
      return createErrorResponse('Missing subdomain parameter', 400)
    }

    if (!/^[a-z0-9-]+$/.test(subdomain)) {
      return NextResponse.json(
        {
          available: false,
          error: 'Invalid subdomain format',
        },
        { status: 400 }
      )
    }

    const reservedSubdomains = [
      'telemetry',
      'docs',
      'api',
      'admin',
      'www',
      'app',
      'auth',
      'blog',
      'help',
      'support',
      'admin',
      'qa',
    ]
    if (reservedSubdomains.includes(subdomain)) {
      return NextResponse.json(
        {
          available: false,
          error: 'This subdomain is reserved',
        },
        { status: 400 }
      )
    }

    const existingDeployment = await db
      .select()
      .from(chat)
      .where(eq(chat.subdomain, subdomain))
      .limit(1)

    return createSuccessResponse({
      available: existingDeployment.length === 0,
      subdomain,
    })
  } catch (error) {
    logger.error('Error checking subdomain availability:', error)
    return createErrorResponse('Failed to check subdomain availability', 500)
  }
}
