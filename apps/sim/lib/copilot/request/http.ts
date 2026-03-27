import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { safeCompare } from '@/lib/core/security/encryption'
import { generateRequestId } from '@/lib/core/utils/request'

export type NotificationStatus =
  | 'pending'
  | 'success'
  | 'error'
  | 'accepted'
  | 'rejected'
  | 'background'
  | 'cancelled'

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
  return generateRequestId()
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

export async function authenticateCopilotRequestSessionOnly(): Promise<CopilotAuthResult> {
  const session = await getSession()
  const userId = session?.user?.id || null

  return {
    userId,
    isAuthenticated: userId !== null,
  }
}

export function checkInternalApiKey(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  const expectedApiKey = env.INTERNAL_API_SECRET

  if (!expectedApiKey) {
    return { success: false, error: 'Internal API key not configured' }
  }

  if (!apiKey) {
    return { success: false, error: 'API key required' }
  }

  if (!safeCompare(apiKey, expectedApiKey)) {
    return { success: false, error: 'Invalid API key' }
  }

  return { success: true }
}
