import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { getNote } from '@/app/api/tools/evernote/lib/client'

export const dynamic = 'force-dynamic'

const logger = createLogger('EvernoteGetNoteAPI')

export async function POST(request: NextRequest) {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { apiKey, noteGuid, withContent = true } = body

    if (!apiKey || !noteGuid) {
      return NextResponse.json(
        { success: false, error: 'apiKey and noteGuid are required' },
        { status: 400 }
      )
    }

    const note = await getNote(apiKey, noteGuid, withContent)

    return NextResponse.json({
      success: true,
      output: { note },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Failed to get note', { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
