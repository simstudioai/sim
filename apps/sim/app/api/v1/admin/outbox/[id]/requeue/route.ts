import { db } from '@sim/db'
import { outboxEvent } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'

const logger = createLogger('AdminOutboxRequeueAPI')

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/admin/outbox/[id]/requeue
 *
 * Move a dead-lettered outbox event back to `pending` so the worker
 * will retry it. Resets `attempts`, `lastError`, and `availableAt` so
 * the next poll picks it up. Only dead-lettered events can be
 * requeued — completed/pending/processing rows are rejected to avoid
 * operator errors.
 */
export const POST = withAdminAuthParams<{ id: string }>(async (_request, { params }) => {
  const { id } = await params

  try {
    const result = await db
      .update(outboxEvent)
      .set({
        status: 'pending',
        attempts: 0,
        lastError: null,
        availableAt: new Date(),
        lockedAt: null,
        processedAt: null,
      })
      .where(and(eq(outboxEvent.id, id), eq(outboxEvent.status, 'dead_letter')))
      .returning({ id: outboxEvent.id, eventType: outboxEvent.eventType })

    if (result.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Event not found or not in dead_letter status. Only dead-lettered events can be requeued.',
        },
        { status: 404 }
      )
    }

    logger.info('Requeued dead-lettered outbox event', {
      eventId: result[0].id,
      eventType: result[0].eventType,
    })

    return NextResponse.json({
      success: true,
      requeued: result[0],
    })
  } catch (error) {
    logger.error('Failed to requeue outbox event', { eventId: id, error: toError(error).message })
    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
