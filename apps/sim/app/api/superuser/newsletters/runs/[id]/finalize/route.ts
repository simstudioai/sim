import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { finalizeNewsletterRunContract } from '@/lib/api/contracts/newsletters'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateNewsletterSuperuser } from '@/lib/newsletters/auth'
import { isNewsletterResendError } from '@/lib/newsletters/resend'
import { finalizeNewsletterRun } from '@/lib/newsletters/runs'

const logger = createLogger('NewsletterFinalizeAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const auth = await validateNewsletterSuperuser()
      if (!auth.success) return auth.response

      const parsed = await parseRequest(finalizeNewsletterRunContract, request, context)
      if (!parsed.success) return parsed.response

      const { run, oversized } = await finalizeNewsletterRun(parsed.data.params.id)
      if (oversized) {
        logger.warn('Newsletter audience exceeded the finalization safety limit', {
          userId: auth.userId,
          runId: run.id,
          totalMatched: run.counts.totalMatched,
        })
      }
      return NextResponse.json({ run })
    } catch (error) {
      const message = getErrorMessage(error)
      if (/not found/i.test(message)) {
        return NextResponse.json({ error: 'Newsletter run not found' }, { status: 404 })
      }
      if (/already in progress/i.test(message)) {
        return NextResponse.json({ error: message }, { status: 409 })
      }
      if (isNewsletterResendError(error)) {
        return NextResponse.json({ error: message }, { status: 503 })
      }
      logger.error('Failed to finalize newsletter run', { error: message })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
