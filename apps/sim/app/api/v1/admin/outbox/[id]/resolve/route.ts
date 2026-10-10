import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import { resolveBillingSyncDeadLetter } from '@/lib/admin/billing-sync-resolution'
import {
  type AdminV1ResolveOutboxEventResponse,
  adminV1ResolveOutboxEventContract,
} from '@/lib/api/contracts/v1/admin'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'

const logger = createLogger('AdminOutboxResolveAPI')

export const dynamic = 'force-dynamic'

const invalidOutboxEventResponse = (message: string) =>
  NextResponse.json({ success: false, error: message }, { status: 400 })

/**
 * POST /api/v1/admin/outbox/[id]/resolve
 *
 * Close a dead-lettered billing Stripe event an operator has remediated by hand or decided needs
 * nothing (see `resolveBillingSyncDeadLetter`). Use `/requeue` to retry one instead.
 *
 * Body: `{ "reason": string, "resolvedBy": string }`
 */
export const POST = withRouteHandler(
  withAdminAuthParams<{ id: string }>(async (request, context) => {
    const parsed = await parseRequest(adminV1ResolveOutboxEventContract, request, context, {
      validationErrorResponse: (error) =>
        invalidOutboxEventResponse(getValidationErrorMessage(error, 'Invalid resolve request')),
      invalidJsonResponse: () => invalidOutboxEventResponse('Request body must be valid JSON'),
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params

    try {
      const resolved = await resolveBillingSyncDeadLetter(id, parsed.data.body, request)
      if (!resolved) {
        return NextResponse.json(
          {
            success: false,
            error:
              'Event not found, not in dead_letter status, or not a billing Stripe event. Only dead-lettered billing Stripe events can be resolved.',
          },
          { status: 404 }
        )
      }

      return NextResponse.json<AdminV1ResolveOutboxEventResponse>({ success: true, resolved })
    } catch (error) {
      logger.error('Failed to resolve outbox event', { eventId: id, error: toError(error).message })
      return NextResponse.json(
        { success: false, error: 'Failed to resolve outbox event' },
        { status: 500 }
      )
    }
  })
)
