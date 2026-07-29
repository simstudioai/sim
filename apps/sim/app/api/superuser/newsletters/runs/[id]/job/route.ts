import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { getNewsletterRunJobContract } from '@/lib/api/contracts/newsletters'
import { parseRequest } from '@/lib/api/server'
import { getJobQueue } from '@/lib/core/async-jobs'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateNewsletterSuperuser } from '@/lib/newsletters/auth'
import { requireNewsletterRun } from '@/lib/newsletters/runs'

const logger = createLogger('NewsletterJobAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const auth = await validateNewsletterSuperuser()
      if (!auth.success) return auth.response

      const parsed = await parseRequest(getNewsletterRunJobContract, request, context)
      if (!parsed.success) return parsed.response

      const run = await requireNewsletterRun(parsed.data.params.id)
      if (!run.resendSyncJobId) return NextResponse.json({ job: null })

      const queue = await getJobQueue()
      const job = await queue.getJob(run.resendSyncJobId)
      return NextResponse.json({
        job: job
          ? {
              id: job.id,
              status: job.status,
              attempts: job.attempts,
              maxAttempts: job.maxAttempts,
              error: job.error ?? null,
              createdAt: job.createdAt.toISOString(),
              startedAt: job.startedAt?.toISOString() ?? null,
              completedAt: job.completedAt?.toISOString() ?? null,
            }
          : null,
      })
    } catch (error) {
      const message = getErrorMessage(error)
      if (/not found/i.test(message)) {
        return NextResponse.json({ error: 'Newsletter run not found' }, { status: 404 })
      }
      logger.error('Failed to get newsletter job', { error: message })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
