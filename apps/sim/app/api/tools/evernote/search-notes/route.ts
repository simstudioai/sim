import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { evernoteSearchNotesContract } from '@/lib/api/contracts/tools/evernote'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { searchNotes } from '@/app/api/tools/evernote/lib/client'

export const dynamic = 'force-dynamic'

const logger = createLogger('EvernoteSearchNotesAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(
      evernoteSearchNotesContract,
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

    const { apiKey, query, notebookGuid, offset, maxNotes } = parsed.data.body
    const clampedMaxNotes = Math.min(Math.max(Number(maxNotes) || 25, 1), 250)

    const result = await searchNotes(
      apiKey,
      query,
      notebookGuid || undefined,
      Number(offset),
      clampedMaxNotes
    )

    return NextResponse.json({
      success: true,
      output: {
        totalNotes: result.totalNotes,
        notes: result.notes,
      },
    })
  } catch (error) {
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('Failed to search notes', { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
