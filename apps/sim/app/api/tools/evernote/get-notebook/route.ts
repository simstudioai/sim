import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
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
    const body = await request.json()
    const { apiKey, notebookGuid } = body

    if (!apiKey || !notebookGuid) {
      return NextResponse.json(
        { success: false, error: 'apiKey and notebookGuid are required' },
        { status: 400 }
      )
    }

    const notebook = await getNotebook(apiKey, notebookGuid)

    return NextResponse.json({
      success: true,
      output: { notebook },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Failed to get notebook', { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
