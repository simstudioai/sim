import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
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
    const body = await request.json()
    const { apiKey, title, content, notebookGuid, tagNames } = body

    if (!apiKey || !title || !content) {
      return NextResponse.json(
        { success: false, error: 'apiKey, title, and content are required' },
        { status: 400 }
      )
    }

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
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Failed to create note', { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
