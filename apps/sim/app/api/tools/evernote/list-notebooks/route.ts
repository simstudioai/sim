import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { evernoteListNotebooksContract } from '@/lib/api/contracts/tools/evernote'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listNotebooks } from '@/app/api/tools/evernote/lib/client'

export const dynamic = 'force-dynamic'

const logger = createLogger('EvernoteListNotebooksAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(
      evernoteListNotebooksContract,
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

    const { apiKey } = parsed.data.body
    const notebooks = await listNotebooks(apiKey)

    return NextResponse.json({
      success: true,
      output: { notebooks },
    })
  } catch (error) {
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('Failed to list notebooks', { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
