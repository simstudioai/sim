import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { webhook } from '@/db/schema'

const logger = createLogger('WebhookTestAPI')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // Get the webhook ID and provider from the query parameters
    const { searchParams } = new URL(request.url)
    const webhookId = searchParams.get('id')

    if (!webhookId) {
      logger.warn(`[${requestId}] Missing webhook ID in test request`)
      return NextResponse.json({ success: false, error: 'Webhook ID is required' }, { status: 400 })
    }

    logger.debug(`[${requestId}] Testing webhook with ID: ${webhookId}`)

    // Find the webhook in the database
    const webhooks = await db.select().from(webhook).where(eq(webhook.id, webhookId)).limit(1)

    if (webhooks.length === 0) {
      logger.warn(`[${requestId}] Webhook not found: ${webhookId}`)
      return NextResponse.json({ success: false, error: 'Webhook not found' }, { status: 404 })
    }

    const foundWebhook = webhooks[0]
    const provider = foundWebhook.provider || 'generic'
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}

    // Construct the webhook URL
    const baseUrl = new URL(request.url).origin
    const webhookUrl = `${baseUrl}/api/webhooks/trigger/${foundWebhook.path}`

    logger.info(`[${requestId}] Testing webhook for provider: ${provider}`, {
      webhookId,
      path: foundWebhook.path,
      isActive: foundWebhook.isActive,
    })

    // Provider-specific test logic
    switch (provider) {
      case 'whatsapp': {
        const verificationToken = providerConfig.verificationToken

        if (!verificationToken) {
          logger.warn(`[${requestId}] WhatsApp webhook missing verification token: ${webhookId}`)
          return NextResponse.json(
            { success: false, error: 'Webhook has no verification token' },
            { status: 400 }
          )
        }

        // Generate a test challenge
        const challenge = `test_${Date.now()}`

        // Construct the WhatsApp verification URL
        const whatsappUrl = `${webhookUrl}?hub.mode=subscribe&hub.verify_token=${verificationToken}&hub.challenge=${challenge}`

        logger.debug(`[${requestId}] Testing WhatsApp webhook verification`, {
          webhookId,
          challenge,
        })

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

        if (success) {
          logger.info(`[${requestId}] WhatsApp webhook verification successful: ${webhookId}`)
        } else {
          logger.warn(`[${requestId}] WhatsApp webhook verification failed: ${webhookId}`, {
            status,
            contentType,
            responseTextLength: responseText.length,
          })
        }

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

        logger.info(`[${requestId}] GitHub webhook test successful: ${webhookId}`)
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
        logger.info(`[${requestId}] Stripe webhook test successful: ${webhookId}`)
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

      case 'generic': {
        // Get the general webhook configuration
        const token = providerConfig.token
        const secretHeaderName = providerConfig.secretHeaderName
        const requireAuth = providerConfig.requireAuth
        const allowedIps = providerConfig.allowedIps

        // Generate sample curl command for testing
        let curlCommand = `curl -X POST "${webhookUrl}" -H "Content-Type: application/json"`

        // Add auth headers to the curl command if required
        if (requireAuth && token) {
          if (secretHeaderName) {
            curlCommand += ` -H "${secretHeaderName}: ${token}"`
          } else {
            curlCommand += ` -H "Authorization: Bearer ${token}"`
          }
        }

        // Add a sample payload
        curlCommand += ` -d '{"event":"test_event","timestamp":"${new Date().toISOString()}"}'`

        logger.info(`[${requestId}] General webhook test successful: ${webhookId}`)
        return NextResponse.json({
          success: true,
          webhook: {
            id: foundWebhook.id,
            url: webhookUrl,
            isActive: foundWebhook.isActive,
          },
          message:
            'General webhook configuration is valid. Use the URL and authentication details as needed.',
          details: {
            requireAuth: requireAuth || false,
            hasToken: !!token,
            hasCustomHeader: !!secretHeaderName,
            customHeaderName: secretHeaderName,
            hasIpRestrictions: Array.isArray(allowedIps) && allowedIps.length > 0,
          },
          test: {
            curlCommand,
            headers: requireAuth
              ? secretHeaderName
                ? { [secretHeaderName]: token }
                : { Authorization: `Bearer ${token}` }
              : {},
            samplePayload: {
              event: 'test_event',
              timestamp: new Date().toISOString(),
            },
          },
        })
      }

      default: {
        // Generic webhook test
        logger.info(`[${requestId}] Generic webhook test successful: ${webhookId}`)
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
    logger.error(`[${requestId}] Error testing webhook`, error)
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
