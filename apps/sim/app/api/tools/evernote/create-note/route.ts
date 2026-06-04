import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { evernoteCreateNoteContract } from '@/lib/api/contracts/tools/evernote'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createNote } from '@/app/api/tools/evernote/lib/client'

export const dynamic = 'force-dynamic'

const logger = createLogger('EvernoteCreateNoteAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(
      evernoteCreateNoteContract,
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

    const { apiKey, title, content, notebookGuid, tagNames } = parsed.data.body
    const parsedTags = tagNames
      ? (() => {
          const tags =
            typeof tagNames === 'string'
              ? tagNames
                  .split(',')
                  .map((t: string) => t.trim())
                  .filter(Boolean)
              : tagNames
          return tags.length > 0 ? tags : undefined
        })()
      : undefined

    const note = await createNote(apiKey, title, content, notebookGuid || undefined, parsedTags)

    return NextResponse.json({
      success: true,
      output: { note },
    })
  } catch (error) {
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('Failed to create note', { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
