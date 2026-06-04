import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { evernoteCreateNotebookContract } from '@/lib/api/contracts/tools/evernote'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createNotebook } from '@/app/api/tools/evernote/lib/client'

export const dynamic = 'force-dynamic'

const logger = createLogger('EvernoteCreateNotebookAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(
      evernoteCreateNotebookContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            { success: false, error: getValidationErrorMessage(error, 'Invalid request') },
            { status: 400 }
          ),
        invalidJsonResponse: () =>
          NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 }),
      }
    )
    if (!parsed.success) return parsed.response

    const { apiKey, name, stack } = parsed.data.body
    const notebook = await createNotebook(apiKey, name, stack || undefined)

    return NextResponse.json({
      success: true,
      output: { notebook },
    })
  } catch (error) {
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('Failed to create notebook', { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
