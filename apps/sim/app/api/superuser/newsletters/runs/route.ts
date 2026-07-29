import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createNewsletterRunContract,
  listNewsletterRunsContract,
} from '@/lib/api/contracts/newsletters'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateNewsletterSuperuser } from '@/lib/newsletters/auth'
import { createNewsletterRun, listNewsletterRuns } from '@/lib/newsletters/runs'
import { NewsletterTargetingPromptError } from '@/lib/newsletters/targeting'

const logger = createLogger('NewsletterRunsAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await validateNewsletterSuperuser()
    if (!auth.success) return auth.response

    const parsed = await parseRequest(listNewsletterRunsContract, request, {})
    if (!parsed.success) return parsed.response

    const { limit, offset } = parsed.data.query
    return NextResponse.json(await listNewsletterRuns(limit, offset))
  } catch (error) {
    logger.error('Failed to list newsletter runs', { error: getErrorMessage(error) })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await validateNewsletterSuperuser()
    if (!auth.success) return auth.response

    const parsed = await parseRequest(
      createNewsletterRunContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            { error: getValidationErrorMessage(error, 'Invalid newsletter run') },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response

    const run = await createNewsletterRun({
      ...parsed.data.body,
      createdById: auth.userId,
    })
    return NextResponse.json({ run })
  } catch (error) {
    if (error instanceof NewsletterTargetingPromptError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error('Failed to create newsletter run', { error: getErrorMessage(error) })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
