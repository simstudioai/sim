import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { apiKey as apiKeyTable } from '@/db/schema'

export type { NotificationStatus } from '@/lib/copilot/types'

/**
 * Authentication result for copilot API routes
 */
export interface CopilotAuthResult {
  userId: string | null
  isAuthenticated: boolean
}

/**
 * Standard error response helpers for copilot API routes
 */
export function createUnauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export function createBadRequestResponse(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 })
}

export function createNotFoundResponse(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 })
}

export function createInternalServerErrorResponse(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 500 })
}

/**
 * Request tracking helpers for copilot API routes
 */
export function createRequestId(): string {
  return crypto.randomUUID()
}

export function createShortRequestId(): string {
  return crypto.randomUUID().slice(0, 8)
}

export interface RequestTracker {
  requestId: string
  startTime: number
  getDuration(): number
}

export function createRequestTracker(short = true): RequestTracker {
  const requestId = short ? createShortRequestId() : createRequestId()
  const startTime = Date.now()

  return {
    requestId,
    startTime,
    getDuration(): number {
      return Date.now() - startTime
    },
  }
}

/**
 * Authenticate request using session or API key fallback
 * Returns userId if authenticated, null otherwise
 */
export async function authenticateCopilotRequest(req: NextRequest): Promise<CopilotAuthResult> {
  // Try session authentication first
  const session = await getSession()
  let userId: string | null = session?.user?.id || null

  // If no session, check for API key auth
  if (!userId) {
    const apiKeyHeader = req.headers.get('x-api-key')
    if (apiKeyHeader) {
      // Verify API key
      const [apiKeyRecord] = await db
        .select({ userId: apiKeyTable.userId })
        .from(apiKeyTable)
        .where(eq(apiKeyTable.key, apiKeyHeader))
        .limit(1)

      if (apiKeyRecord) {
        userId = apiKeyRecord.userId
      }
    }
  }

  return {
    userId,
    isAuthenticated: userId !== null,
  }
}

/**
 * Authenticate request using session only (no API key fallback)
 * Returns userId if authenticated, null otherwise
 */
export async function authenticateCopilotRequestSessionOnly(): Promise<CopilotAuthResult> {
  const session = await getSession()
  const userId = session?.user?.id || null

  return {
    userId,
    isAuthenticated: userId !== null,
  }
}
