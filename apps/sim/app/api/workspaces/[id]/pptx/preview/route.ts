import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generatePptxFromCode } from '@/lib/execution/doc-vm'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const logger = createLogger('PptxPreviewAPI')

/**
 * POST /api/workspaces/[id]/pptx/preview
 * Compile PptxGenJS source code and return the binary PPTX for streaming preview.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workspaceId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const membership = await verifyWorkspaceMembership(session.user.id, workspaceId)
    if (!membership) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid or missing JSON body' }, { status: 400 })
    }
    const { code } = body as { code?: string }

    if (typeof code !== 'string' || code.trim().length === 0) {
      return NextResponse.json({ error: 'code is required' }, { status: 400 })
    }

    const MAX_CODE_BYTES = 512 * 1024
    if (Buffer.byteLength(code, 'utf-8') > MAX_CODE_BYTES) {
      return NextResponse.json({ error: 'code exceeds maximum size' }, { status: 413 })
    }

    const buffer = await generatePptxFromCode(code, workspaceId, req.signal)

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'PPTX generation failed'
    logger.error('PPTX preview generation failed', { error: message, workspaceId })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
