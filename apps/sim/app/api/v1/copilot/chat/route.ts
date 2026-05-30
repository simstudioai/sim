import { NextResponse } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

/**
 * POST /api/v1/copilot/chat
 *
 * Deprecated: the v1 headless copilot chat API has been removed. The endpoint
 * returns 410 Gone for all callers.
 */
export const POST = withRouteHandler(async () =>
  NextResponse.json(
    {
      success: false,
      error: 'The v1 copilot chat API has been deprecated and is no longer available.',
    },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  )
)
