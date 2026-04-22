import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkServerSideUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import { CopilotValidateOutcome } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { checkInternalApiKey } from '@/lib/copilot/request/http'
import { withIncomingGoSpan } from '@/lib/copilot/request/otel'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopilotApiKeysValidate')

const ValidateApiKeySchema = z.object({
  userId: z.string().min(1, 'userId is required'),
})

// Incoming-from-Go: extracts traceparent so this handler's work shows
// up as a child of the Go-side `sim.validate_api_key` span in the same
// trace. If there's no traceparent (manual curl / browser), the helper
// falls back to a new root span.
export const POST = withRouteHandler((req: NextRequest) =>
  withIncomingGoSpan(
    req.headers,
    TraceSpan.CopilotAuthValidateApiKey,
    {
      [TraceAttr.HttpMethod]: 'POST',
      [TraceAttr.HttpRoute]: '/api/copilot/api-keys/validate',
    },
    async (span) => {
      try {
        const auth = checkInternalApiKey(req)
        if (!auth.success) {
          span.setAttribute(
            TraceAttr.CopilotValidateOutcome,
            CopilotValidateOutcome.InternalAuthFailed
          )
          span.setAttribute(TraceAttr.HttpStatusCode, 401)
          return new NextResponse(null, { status: 401 })
        }

        const body = await req.json().catch(() => null)
        const validationResult = ValidateApiKeySchema.safeParse(body)
        if (!validationResult.success) {
          logger.warn('Invalid validation request', { errors: validationResult.error.errors })
          span.setAttribute(TraceAttr.CopilotValidateOutcome, CopilotValidateOutcome.InvalidBody)
          span.setAttribute(TraceAttr.HttpStatusCode, 400)
          return NextResponse.json(
            {
              error: 'userId is required',
              details: validationResult.error.errors,
            },
            { status: 400 }
          )
        }

        const { userId } = validationResult.data
        span.setAttribute(TraceAttr.UserId, userId)

        const [existingUser] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
        if (!existingUser) {
          logger.warn('[API VALIDATION] userId does not exist', { userId })
          span.setAttribute(TraceAttr.CopilotValidateOutcome, CopilotValidateOutcome.UserNotFound)
          span.setAttribute(TraceAttr.HttpStatusCode, 403)
          return NextResponse.json({ error: 'User not found' }, { status: 403 })
        }

        logger.info('[API VALIDATION] Validating usage limit', { userId })
        const { isExceeded, currentUsage, limit } = await checkServerSideUsageLimits(userId)
        span.setAttributes({
          [TraceAttr.BillingUsageCurrent]: currentUsage,
          [TraceAttr.BillingUsageLimit]: limit,
          [TraceAttr.BillingUsageExceeded]: isExceeded,
        })

        logger.info('[API VALIDATION] Usage limit validated', {
          userId,
          currentUsage,
          limit,
          isExceeded,
        })

        if (isExceeded) {
          logger.info('[API VALIDATION] Usage exceeded', { userId, currentUsage, limit })
          span.setAttribute(TraceAttr.CopilotValidateOutcome, CopilotValidateOutcome.UsageExceeded)
          span.setAttribute(TraceAttr.HttpStatusCode, 402)
          return new NextResponse(null, { status: 402 })
        }

        span.setAttribute(TraceAttr.CopilotValidateOutcome, CopilotValidateOutcome.Ok)
        span.setAttribute(TraceAttr.HttpStatusCode, 200)
        return new NextResponse(null, { status: 200 })
      } catch (error) {
        logger.error('Error validating usage limit', { error })
        span.setAttribute(TraceAttr.CopilotValidateOutcome, CopilotValidateOutcome.InternalError)
        span.setAttribute(TraceAttr.HttpStatusCode, 500)
        return NextResponse.json({ error: 'Failed to validate usage' }, { status: 500 })
      }
    }
  )
)
