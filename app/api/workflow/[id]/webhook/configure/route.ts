import { NextRequest, NextResponse } from 'next/server'
import { WebhookConfig } from '@/lib/types'
import { configureWebhook, getWorkflowById } from '@/lib/workflows'

/**
 * Configure webhook settings for a workflow
 *
 * This endpoint handles:
 * - Enabling/disabling webhooks for a workflow
 * - Setting the webhook secret token
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const workflowId = params.id

  // Check if workflow exists
  const workflow = await getWorkflowById(workflowId)

  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  try {
    // Parse request body
    const body = await request.json()
    const { enabled, secretToken } = body as {
      enabled: boolean
      secretToken?: string
    }

    // Configure webhook
    const result = await configureWebhook(workflowId, enabled, secretToken)

    return NextResponse.json(result)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json(
      { error: 'Failed to configure webhook', message: errorMessage },
      { status: 500 }
    )
  }
}

/**
 * Get webhook configuration for a workflow
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const workflowId = params.id

  // Check if workflow exists
  const workflow = await getWorkflowById(workflowId)

  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  const webhookConfig = workflow.webhookConfig as WebhookConfig | null

  return NextResponse.json({
    webhookEnabled: workflow.executionMethod === 'webhook',
    webhookConfig: webhookConfig || null,
  })
}
