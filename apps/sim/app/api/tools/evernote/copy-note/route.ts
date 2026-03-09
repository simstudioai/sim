import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { copyNote } from '@/app/api/tools/evernote/lib/client'

export const dynamic = 'force-dynamic'

const logger = createLogger('EvernoteCopyNoteAPI')

export async function POST(request: NextRequest) {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { apiKey, noteGuid, toNotebookGuid } = body

    if (!apiKey || !noteGuid || !toNotebookGuid) {
      return NextResponse.json(
        { success: false, error: 'apiKey, noteGuid, and toNotebookGuid are required' },
        { status: 400 }
      )
    }

    const note = await copyNote(apiKey, noteGuid, toNotebookGuid)

    return NextResponse.json({
      success: true,
      output: { note },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Failed to copy note', { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
