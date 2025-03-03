import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { WebhookConfig } from '@/lib/types'
import { getWebhookConfig, getWorkflowById } from '@/lib/workflows'

/**
 * Endpoint for testing webhooks from the UI
 * This simulates an external service calling the webhook
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const workflowId = params.id

  // Verify the workflow exists and has webhooks enabled
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

  // Get the test payload from the request body or use a default payload
  const body = await request.json().catch(() => ({}))
  const testPayload = body.payload || {
    test: true,
    timestamp: new Date().toISOString(),
    message: 'This is a test webhook payload',
  }

  // Convert payload to string for signature
  const payloadString = JSON.stringify(testPayload)

  // Create the signature using the webhook secret
  const signature = webhookConfig.secretToken
    ? crypto.createHmac('sha256', webhookConfig.secretToken).update(payloadString).digest('hex')
    : undefined

  // Call the actual webhook endpoint internally
  const webhookUrl = new URL(`/api/workflow/${workflowId}/webhook/receive`, request.url)

  try {
    const webhookResponse = await fetch(webhookUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signature ? { 'x-webhook-signature': signature } : {}),
        'x-webhook-test': '1',
      },
      body: payloadString,
    })

    const result = await webhookResponse.json()

    if (!webhookResponse.ok) {
      return NextResponse.json(
        { error: 'Webhook test failed', details: result },
        { status: webhookResponse.status }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Webhook test executed successfully',
      webhookResponse: result,
      testDetails: {
        url: webhookUrl.toString(),
        payload: testPayload,
        signature: signature ? `${signature.substring(0, 8)}...` : 'None (insecure)',
      },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json(
      { error: 'Failed to execute webhook test', message: errorMessage },
      { status: 500 }
    )
  }
}
