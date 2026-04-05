import { NextResponse } from 'next/server'
import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'

export const slackHandler: WebhookProviderHandler = {
  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    if (obj.event_id) {
      return String(obj.event_id)
    }

    const event = obj.event as Record<string, unknown> | undefined
    if (event?.ts && obj.team_id) {
      return `${obj.team_id}:${event.ts}`
    }

    return null
  },

  formatSuccessResponse() {
    return new NextResponse(null, { status: 200 })
  },

  formatQueueErrorResponse() {
    return new NextResponse(null, { status: 200 })
  },
}
