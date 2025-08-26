import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { apiKey as apiKeyTable } from '@/db/schema'

export type { NotificationStatus } from '@/lib/copilot/types'

export interface CopilotAuthResult {
  userId: string | null
  isAuthenticated: boolean
}

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

export async function authenticateCopilotRequest(req: NextRequest): Promise<CopilotAuthResult> {
  const session = await getSession()
  let userId: string | null = session?.user?.id || null

  if (!userId) {
    const apiKeyHeader = req.headers.get('x-api-key')
    if (apiKeyHeader) {
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

export async function authenticateCopilotRequestSessionOnly(): Promise<CopilotAuthResult> {
  const session = await getSession()
  const userId = session?.user?.id || null

  return {
    userId,
    isAuthenticated: userId !== null,
  }
}
