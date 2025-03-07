import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { webhook, workflow } from '@/db/schema'

export const dynamic = 'force-dynamic'

// Get a specific webhook
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          name: workflow.name,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(and(eq(webhook.id, params.id), eq(workflow.userId, session.user.id)))
      .limit(1)

    if (webhooks.length === 0) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    return NextResponse.json({ webhook: webhooks[0] }, { status: 200 })
  } catch (error) {
    console.error('Error fetching webhook:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Update a webhook
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { path, provider, providerConfig, isActive } = body

    // Find the webhook and check ownership
    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          userId: workflow.userId,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(webhook.id, params.id))
      .limit(1)

    if (webhooks.length === 0) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    if (webhooks[0].workflow.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Update the webhook
    const updatedWebhook = await db
      .update(webhook)
      .set({
        path: path !== undefined ? path : webhooks[0].webhook.path,
        provider: provider !== undefined ? provider : webhooks[0].webhook.provider,
        providerConfig:
          providerConfig !== undefined ? providerConfig : webhooks[0].webhook.providerConfig,
        isActive: isActive !== undefined ? isActive : webhooks[0].webhook.isActive,
        updatedAt: new Date(),
      })
      .where(eq(webhook.id, params.id))
      .returning()

    return NextResponse.json({ webhook: updatedWebhook[0] }, { status: 200 })
  } catch (error) {
    console.error('Error updating webhook:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Delete a webhook
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Find the webhook and check ownership
    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          userId: workflow.userId,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(webhook.id, params.id))
      .limit(1)

    if (webhooks.length === 0) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    if (webhooks[0].workflow.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Delete the webhook
    await db.delete(webhook).where(eq(webhook.id, params.id))

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('Error deleting webhook:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
