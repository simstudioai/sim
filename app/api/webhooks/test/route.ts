import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { webhook } from '@/db/schema'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Get the webhook ID and provider from the query parameters
    const { searchParams } = new URL(request.url)
    const webhookId = searchParams.get('id')

    if (!webhookId) {
      return NextResponse.json({ success: false, error: 'Webhook ID is required' }, { status: 400 })
    }

    // Find the webhook in the database
    const webhooks = await db.select().from(webhook).where(eq(webhook.id, webhookId)).limit(1)

    if (webhooks.length === 0) {
      return NextResponse.json({ success: false, error: 'Webhook not found' }, { status: 404 })
    }

    const foundWebhook = webhooks[0]
    const provider = foundWebhook.provider || 'generic'
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}

    // Construct the webhook URL
    const baseUrl = new URL(request.url).origin
    const webhookUrl = `${baseUrl}/api/webhooks/trigger/${foundWebhook.path}`

    // Provider-specific test logic
    switch (provider) {
      case 'whatsapp': {
        const verificationToken = providerConfig.verificationToken

        if (!verificationToken) {
          return NextResponse.json(
            { success: false, error: 'Webhook has no verification token' },
            { status: 400 }
          )
        }

        // Generate a test challenge
        const challenge = `test_${Date.now()}`

        // Construct the WhatsApp verification URL
        const whatsappUrl = `${webhookUrl}?hub.mode=subscribe&hub.verify_token=${verificationToken}&hub.challenge=${challenge}`

        // Make a request to the webhook endpoint
        const response = await fetch(whatsappUrl, {
          headers: {
            'User-Agent': 'facebookplatform/1.0',
          },
        })

        // Get the response details
        const status = response.status
        const contentType = response.headers.get('content-type')
        const responseText = await response.text()

        // Check if the test was successful
        const success = status === 200 && responseText === challenge

        return NextResponse.json({
          success,
          webhook: {
            id: foundWebhook.id,
            url: webhookUrl,
            verificationToken,
            isActive: foundWebhook.isActive,
          },
          test: {
            status,
            contentType,
            responseText,
            expectedStatus: 200,
            expectedContentType: 'text/plain',
            expectedResponse: challenge,
          },
          message: success
            ? 'Webhook configuration is valid. You can now use this URL in WhatsApp.'
            : 'Webhook verification failed. Please check your configuration.',
          diagnostics: {
            statusMatch: status === 200 ? '✅ Status code is 200' : '❌ Status code should be 200',
            contentTypeMatch:
              contentType === 'text/plain'
                ? '✅ Content-Type is text/plain'
                : '❌ Content-Type should be text/plain',
            bodyMatch:
              responseText === challenge
                ? '✅ Response body matches challenge'
                : '❌ Response body should exactly match the challenge string',
          },
        })
      }

      case 'github': {
        const contentType = providerConfig.contentType || 'application/json'

        return NextResponse.json({
          success: true,
          webhook: {
            id: foundWebhook.id,
            url: webhookUrl,
            contentType,
            isActive: foundWebhook.isActive,
          },
          message:
            'GitHub webhook configuration is valid. Use this URL in your GitHub repository settings.',
          setup: {
            url: webhookUrl,
            contentType,
            events: ['push', 'pull_request', 'issues', 'issue_comment'],
          },
        })
      }

      case 'stripe': {
        return NextResponse.json({
          success: true,
          webhook: {
            id: foundWebhook.id,
            url: webhookUrl,
            isActive: foundWebhook.isActive,
          },
          message: 'Stripe webhook configuration is valid. Use this URL in your Stripe dashboard.',
          setup: {
            url: webhookUrl,
            events: [
              'charge.succeeded',
              'invoice.payment_succeeded',
              'customer.subscription.created',
            ],
          },
        })
      }

      default: {
        // Generic webhook test
        return NextResponse.json({
          success: true,
          webhook: {
            id: foundWebhook.id,
            url: webhookUrl,
            provider: foundWebhook.provider,
            isActive: foundWebhook.isActive,
          },
          message:
            'Webhook configuration is valid. You can use this URL to receive webhook events.',
        })
      }
    }
  } catch (error: any) {
    console.error('Error testing webhook:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Test failed',
        message: error.message,
      },
      { status: 500 }
    )
  }
}
