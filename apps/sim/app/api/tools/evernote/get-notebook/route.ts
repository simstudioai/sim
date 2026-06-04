import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { evernoteGetNotebookContract } from '@/lib/api/contracts/tools/evernote'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getNotebook } from '@/app/api/tools/evernote/lib/client'

export const dynamic = 'force-dynamic'

const logger = createLogger('EvernoteGetNotebookAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(
      evernoteGetNotebookContract,
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

    const { apiKey, notebookGuid } = parsed.data.body
    const notebook = await getNotebook(apiKey, notebookGuid)

    return NextResponse.json({
      success: true,
      output: { notebook },
    })
  } catch (error) {
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('Failed to get notebook', { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
