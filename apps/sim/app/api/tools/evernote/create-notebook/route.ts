import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createNotebook } from '@/app/api/tools/evernote/lib/client'

export const dynamic = 'force-dynamic'

const logger = createLogger('EvernoteCreateNotebookAPI')

export async function POST(request: NextRequest) {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { apiKey, name, stack } = body

    if (!apiKey || !name) {
      return NextResponse.json(
        { success: false, error: 'apiKey and name are required' },
        { status: 400 }
      )
    }

    const notebook = await createNotebook(apiKey, name, stack || undefined)

    return NextResponse.json({
      success: true,
      output: { notebook },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Failed to create notebook', { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
