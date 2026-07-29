import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { pushNewsletterRunToResendContract } from '@/lib/api/contracts/newsletters'
import { parseRequest } from '@/lib/api/server'
import { isAsyncJobEnqueueError } from '@/lib/core/async-jobs'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateNewsletterSuperuser } from '@/lib/newsletters/auth'
import { enqueueNewsletterResendSync } from '@/lib/newsletters/push-resend'

const logger = createLogger('NewsletterPushResendAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const auth = await validateNewsletterSuperuser()
      if (!auth.success) return auth.response

      const parsed = await parseRequest(pushNewsletterRunToResendContract, request, context)
      if (!parsed.success) return parsed.response

      const { run, jobId } = await enqueueNewsletterResendSync(parsed.data.params.id, auth.userId)
      return NextResponse.json({ run, jobId })
    } catch (error) {
      const message = getErrorMessage(error)
      if (/not found/i.test(message)) {
        return NextResponse.json({ error: 'Newsletter run not found' }, { status: 404 })
      }
      if (/finalize|RESEND_API_KEY/i.test(message)) {
        return NextResponse.json({ error: message }, { status: 400 })
      }
      if (isAsyncJobEnqueueError(error)) {
        return NextResponse.json(
          { error: 'Newsletter sync enqueue is uncertain; retry to resume the same attempt' },
          { status: 503 }
        )
      }
      if (/tracking persistence failed/i.test(message)) {
        return NextResponse.json(
          { error: 'Newsletter sync was accepted but job tracking is not yet available; retry' },
          { status: 503 }
        )
      }
      logger.error('Failed to enqueue newsletter Resend push', { error: message })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
