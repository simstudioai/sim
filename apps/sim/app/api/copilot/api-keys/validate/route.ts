import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkServerSideUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { checkInternalApiKey } from '@/lib/copilot/request/http'
import { withIncomingGoSpan } from '@/lib/copilot/request/otel'

const logger = createLogger('CopilotApiKeysValidate')

const ValidateApiKeySchema = z.object({
  userId: z.string().min(1, 'userId is required'),
})

export async function POST(req: NextRequest) {
  // Incoming-from-Go: extracts traceparent so this handler's work shows
  // up as a child of the Go-side `sim.validate_api_key` span in the same
  // trace. If there's no traceparent (manual curl / browser), the helper
  // falls back to a new root span.
  return withIncomingGoSpan(
    req.headers,
    TraceSpan.CopilotAuthValidateApiKey,
    {
      'http.method': 'POST',
      'http.route': '/api/copilot/api-keys/validate',
    },
    async (span) => {
      try {
        const auth = checkInternalApiKey(req)
        if (!auth.success) {
          span.setAttribute('copilot.validate.outcome', 'internal_auth_failed')
          span.setAttribute('http.status_code', 401)
          return new NextResponse(null, { status: 401 })
        }

        const body = await req.json().catch(() => null)
        const validationResult = ValidateApiKeySchema.safeParse(body)
        if (!validationResult.success) {
          logger.warn('Invalid validation request', { errors: validationResult.error.errors })
          span.setAttribute('copilot.validate.outcome', 'invalid_body')
          span.setAttribute('http.status_code', 400)
          return NextResponse.json(
            {
              error: 'userId is required',
              details: validationResult.error.errors,
            },
            { status: 400 }
          )
        }

        const { userId } = validationResult.data
        span.setAttribute('user.id', userId)

        const [existingUser] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
        if (!existingUser) {
          logger.warn('[API VALIDATION] userId does not exist', { userId })
          span.setAttribute('copilot.validate.outcome', 'user_not_found')
          span.setAttribute('http.status_code', 403)
          return NextResponse.json({ error: 'User not found' }, { status: 403 })
        }

        logger.info('[API VALIDATION] Validating usage limit', { userId })
        const { isExceeded, currentUsage, limit } = await checkServerSideUsageLimits(userId)
        span.setAttributes({
          'billing.usage.current': currentUsage,
          'billing.usage.limit': limit,
          'billing.usage.exceeded': isExceeded,
        })

        logger.info('[API VALIDATION] Usage limit validated', {
          userId,
          currentUsage,
          limit,
          isExceeded,
        })

        if (isExceeded) {
          logger.info('[API VALIDATION] Usage exceeded', { userId, currentUsage, limit })
          span.setAttribute('copilot.validate.outcome', 'usage_exceeded')
          span.setAttribute('http.status_code', 402)
          return new NextResponse(null, { status: 402 })
        }

        span.setAttribute('copilot.validate.outcome', 'ok')
        span.setAttribute('http.status_code', 200)
        return new NextResponse(null, { status: 200 })
      } catch (error) {
        logger.error('Error validating usage limit', { error })
        span.setAttribute('copilot.validate.outcome', 'internal_error')
        span.setAttribute('http.status_code', 500)
        return NextResponse.json({ error: 'Failed to validate usage' }, { status: 500 })
      }
    }
  )
}
