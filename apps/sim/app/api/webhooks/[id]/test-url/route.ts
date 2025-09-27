import { db, webhook, workflow } from '@sim/db'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { signTestWebhookToken } from '@/lib/webhooks/test-tokens'

const logger = createLogger('MintWebhookTestUrlAPI')

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const ttlSeconds = Math.max(
      60,
      Math.min(60 * 60 * 24 * 30, Number(body?.ttlSeconds) || 60 * 60 * 24 * 7)
    )

    // Load webhook + workflow for permission check
    const rows = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          userId: workflow.userId,
          workspaceId: workflow.workspaceId,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(webhook.id, id))
      .limit(1)

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    const wf = rows[0].workflow

    // Permissions: owner OR workspace write/admin
    let canMint = false
    if (wf.userId === session.user.id) {
      canMint = true
    } else if (wf.workspaceId) {
      const perm = await getUserEntityPermissions(session.user.id, 'workspace', wf.workspaceId)
      if (perm === 'write' || perm === 'admin') {
        canMint = true
      }
    }

    if (!canMint) {
      logger.warn(`[${requestId}] User ${session.user.id} denied mint for webhook ${id}`)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const origin = new URL(request.url).origin
    const effectiveOrigin = origin.includes('localhost')
      ? env.NEXT_PUBLIC_APP_URL || origin
      : origin

    const token = await signTestWebhookToken(id, ttlSeconds)
    const url = `${effectiveOrigin}/api/webhooks/test/${id}?token=${encodeURIComponent(token)}`

    logger.info(`[${requestId}] Minted test URL for webhook ${id}`)
    return NextResponse.json({
      url,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    })
  } catch (error: any) {
    logger.error('Error minting test webhook URL', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
