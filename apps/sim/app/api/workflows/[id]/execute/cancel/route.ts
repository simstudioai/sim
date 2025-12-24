import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { requestCancellation } from '@/lib/execution/cancellation'

const CancelExecutionSchema = z.object({
  executionId: z.string().uuid(),
})

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await params

  const auth = await checkHybridAuth(req, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  let body: any = {}
  try {
    const text = await req.text()
    if (text) {
      body = JSON.parse(text)
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const validation = CancelExecutionSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { executionId } = validation.data
  const success = await requestCancellation(executionId)
  return NextResponse.json({ success })
}
