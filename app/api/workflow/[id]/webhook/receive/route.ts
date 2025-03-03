import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { WebhookConfig, WebhookData } from '@/lib/types'
import {
  getWebhookConfig,
  getWorkflowById,
  logWebhookExecution,
  validateWebhookSignature,
} from '@/lib/workflows'

/**
 * Handle incoming webhook requests
 *
 * This function validates the webhook, processes the payload,
 * and executes the associated workflow.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const workflowId = params.id
  const executionId = randomUUID()

  // Get the workflow to verify it exists and has webhooks enabled
  const workflow = await getWorkflowById(workflowId)
  const webhookConfig = (await getWebhookConfig(workflowId)) as WebhookConfig | null

  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  if (workflow.executionMethod !== 'webhook' || !webhookConfig?.isActive) {
    return NextResponse.json(
      { error: 'Webhook is not configured or is inactive for this workflow' },
      { status: 404 }
    )
  }

  // Get the client IP for logging
  const ipAddress =
    request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'

  // Verify webhook signature if provided
  const signature = request.headers.get('x-webhook-signature')
  let signatureValid = false

  // Get the raw body for signature validation
  const rawBody = await request.text()

  if (signature && webhookConfig.secretToken) {
    signatureValid = validateWebhookSignature(signature, webhookConfig.secretToken, rawBody)

    if (!signatureValid) {
      // Log the invalid signature attempt
      const webhookData: WebhookData = {
        requestHeaders: Object.fromEntries(request.headers.entries()),
        requestBody: { error: 'Invalid signature' },
        signatureValid: false,
        ipAddress: ipAddress as string,
      }

      await logWebhookExecution(
        workflowId,
        executionId,
        webhookData,
        'Webhook execution failed: Invalid signature'
      )

      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
    }
  }

  // Parse the request body
  let parsedBody
  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : {}
  } catch (error) {
    // Log the invalid payload attempt
    const webhookData: WebhookData = {
      requestHeaders: Object.fromEntries(request.headers.entries()),
      requestBody: { error: 'Invalid JSON payload', raw: rawBody },
      signatureValid,
      ipAddress: ipAddress as string,
    }

    await logWebhookExecution(
      workflowId,
      executionId,
      webhookData,
      'Webhook execution failed: Invalid JSON payload'
    )

    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  // Log the webhook execution
  const webhookData: WebhookData = {
    requestHeaders: Object.fromEntries(request.headers.entries()),
    requestBody: parsedBody,
    signatureValid,
    ipAddress: ipAddress as string,
  }

  await logWebhookExecution(workflowId, executionId, webhookData)

  try {
    // Import the execute function dynamically to avoid circular dependencies
    const executeModule = await import('@/app/api/workflow/[id]/execute/route')

    // Get the appropriate execute function from the module
    const executeWorkflow = executeModule.executeWorkflow || executeModule.POST

    if (!executeWorkflow) {
      throw new Error('Could not find execute function in module')
    }

    // Execute the workflow with the webhook payload as input
    const result = await executeWorkflow(workflow, {
      webhook: parsedBody,
      executionId,
      triggerSource: 'webhook',
    })

    return NextResponse.json({
      success: true,
      executionId,
      result,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Log the execution error
    const errorWebhookData: WebhookData = {
      ...webhookData,
      requestBody: {
        ...(webhookData.requestBody as any),
        error: errorMessage,
      },
    }

    await logWebhookExecution(
      workflowId,
      executionId,
      errorWebhookData,
      `Webhook execution error: ${errorMessage}`
    )

    return NextResponse.json(
      {
        error: 'Failed to execute workflow',
        message: errorMessage,
        executionId,
      },
      { status: 500 }
    )
  }
}

/**
 * Handle GET requests to verify webhook configuration
 *
 * This is useful for testing webhook configuration and can
 * be used by external services to verify the webhook is valid.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const workflowId = params.id

  // Get the workflow to verify it exists and has webhooks enabled
  const workflow = await getWorkflowById(workflowId)
  const webhookConfig = (await getWebhookConfig(workflowId)) as WebhookConfig | null

  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  if (workflow.executionMethod !== 'webhook' || !webhookConfig?.isActive) {
    return NextResponse.json(
      { error: 'Webhook is not configured or is inactive for this workflow' },
      { status: 404 }
    )
  }

  return NextResponse.json({
    message: 'Webhook is properly configured and active',
    workflowId,
  })
}
