import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { getNewsletterRunContract } from '@/lib/api/contracts/newsletters'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateNewsletterSuperuser } from '@/lib/newsletters/auth'
import { getNewsletterRun } from '@/lib/newsletters/runs'

const logger = createLogger('NewsletterRunAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const auth = await validateNewsletterSuperuser()
      if (!auth.success) return auth.response

      const parsed = await parseRequest(getNewsletterRunContract, request, context)
      if (!parsed.success) return parsed.response

      const run = await getNewsletterRun(parsed.data.params.id)
      if (!run) return NextResponse.json({ error: 'Newsletter run not found' }, { status: 404 })
      return NextResponse.json({ run })
    } catch (error) {
      logger.error('Failed to get newsletter run', { error: getErrorMessage(error) })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
