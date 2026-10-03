import { NextResponse } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

/**
 * POST /api/v1/copilot/chat
 *
 * Deprecated: the v1 headless copilot chat API has been removed. The endpoint
 * returns 410 Gone for all callers.
 *
 * permission-group-exempt: none — the route authenticates nobody and reaches no
 * resource, so there is no workspace in which to resolve a group. The
 * counterpart `chat.send` declares `copilot.use`; when this surface returns
 * anything but 410 again, it declares that capability.
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
