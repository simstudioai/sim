import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '@/db'
import { webhook, workflow } from '@/db/schema'
import { Executor } from '@/executor'
import { SerializedWorkflow } from '@/serializer/types'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    // Get the webhook path from the URL
    const url = new URL(request.url)
    const path = url.pathname.replace('/api/webhooks/trigger', '')

    if (!path || path === '/') {
      return new NextResponse('Invalid webhook path', { status: 400 })
    }

    // Find the webhook in the database
    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: workflow,
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(and(eq(webhook.path, path), eq(webhook.isActive, true), eq(workflow.isDeployed, true)))
      .limit(1)

    if (webhooks.length === 0) {
      return new NextResponse('Webhook not found', { status: 404 })
    }

    const { webhook: foundWebhook, workflow: foundWorkflow } = webhooks[0]

    // Verify webhook secret if provided
    if (foundWebhook.secret) {
      const authHeader = request.headers.get('authorization')
      const providedSecret = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null

      if (!providedSecret || providedSecret !== foundWebhook.secret) {
        return new NextResponse('Unauthorized', { status: 401 })
      }
    }

    // Parse the request body
    const body = await request.json().catch(() => ({}))

    // Create execution context with the webhook payload
    const executionId = nanoid()

    // Format the input to match the expected BlockOutput type
    const input = {
      webhook: {
        data: {
          path,
          provider: foundWebhook.provider,
          payload: body,
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        },
      },
    }

    // Execute the workflow
    if (foundWorkflow.state) {
      const executor = new Executor(foundWorkflow.state as SerializedWorkflow, input)
      const result = await executor.execute(foundWorkflow.id)

      // Return the execution result
      return NextResponse.json(result, { status: 200 })
    }

    return new NextResponse('Workflow state not found', { status: 500 })
  } catch (error: any) {
    console.error('Error processing webhook:', error)
    return new NextResponse(`Internal Server Error: ${error.message}`, { status: 500 })
  }
}
