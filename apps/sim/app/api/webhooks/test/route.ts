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

      case 'telegram': {
        const botToken = providerConfig.botToken
        const triggerPhrase = providerConfig.triggerPhrase

        if (!botToken || !triggerPhrase) {
          logger.warn(`[${requestId}] Telegram webhook missing configuration: ${webhookId}`)
          return NextResponse.json(
            { success: false, error: 'Webhook has incomplete configuration' },
            { status: 400 }
          )
        }

        // Test the webhook endpoint with a simple message to check if it's reachable
        const testMessage = {
          update_id: 12345,
          message: {
            message_id: 67890,
            from: {
              id: 123456789,
              first_name: 'Test',
              username: 'testbot',
            },
            chat: {
              id: 123456789,
              first_name: 'Test',
              username: 'testbot',
              type: 'private',
            },
            date: Math.floor(Date.now() / 1000),
            text: 'This is a test message',
          },
        }

        logger.debug(`[${requestId}] Testing Telegram webhook connection`, {
          webhookId,
          url: webhookUrl,
        })

        // Make a test request to the webhook endpoint
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'TelegramBot/1.0',
          },
          body: JSON.stringify(testMessage),
        })

        // Get the response details
        const status = response.status
        let responseText = ''
        try {
          responseText = await response.text()
        } catch (e) {
          // Ignore if we can't get response text
        }

        // Consider success if we get a 2xx response
        const success = status >= 200 && status < 300

        if (success) {
          logger.info(`[${requestId}] Telegram webhook test successful: ${webhookId}`)
        } else {
          logger.warn(`[${requestId}] Telegram webhook test failed: ${webhookId}`, {
            status,
            responseText,
          })
        }

        // Get webhook info from Telegram API
        let webhookInfo = null
        try {
          const webhookInfoUrl = `https://api.telegram.org/bot${botToken}/getWebhookInfo`
          const infoResponse = await fetch(webhookInfoUrl, {
            headers: {
              'User-Agent': 'TelegramBot/1.0',
            },
          })
          if (infoResponse.ok) {
            const infoJson = await infoResponse.json()
            if (infoJson.ok) {
              webhookInfo = infoJson.result
            }
          }
        } catch (e) {
          logger.warn(`[${requestId}] Failed to get Telegram webhook info`, e)
        }

        // Format the curl command for testing
        const curlCommand = [
          `curl -X POST "${webhookUrl}"`,
          `-H "Content-Type: application/json"`,
          `-H "User-Agent: TelegramBot/1.0"`,
          `-d '${JSON.stringify(testMessage, null, 2)}'`,
        ].join(' \\\n')

        return NextResponse.json({
          success,
          webhook: {
            id: foundWebhook.id,
            url: webhookUrl,
            botToken: `${botToken.substring(0, 5)}...${botToken.substring(botToken.length - 5)}`, // Show partial token for security
            triggerPhrase,
            isActive: foundWebhook.isActive,
          },
          test: {
            status,
            responseText,
            webhookInfo,
          },
          message: success
            ? 'Telegram webhook appears to be working. Your bot should now receive messages.'
            : 'Telegram webhook test failed. Please check server logs for more details.',
          curlCommand,
          info: 'To fix issues with Telegram webhooks getting 403 Forbidden responses, ensure the webhook request includes a User-Agent header.',
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

      case 'slack': {
        const signingSecret = providerConfig.signingSecret

        if (!signingSecret) {
          logger.warn(`[${requestId}] Slack webhook missing signing secret: ${webhookId}`)
          return NextResponse.json(
            { success: false, error: 'Webhook has no signing secret configured' },
            { status: 400 }
          )
        }

        logger.info(`[${requestId}] Slack webhook test successful: ${webhookId}`)
        return NextResponse.json({
          success: true,
          webhook: {
            id: foundWebhook.id,
            url: webhookUrl,
            isActive: foundWebhook.isActive,
          },
          message:
            'Slack webhook configuration is valid. Use this URL in your Slack Event Subscriptions settings.',
          setup: {
            url: webhookUrl,
            events: ['message.channels', 'reaction_added', 'app_mention'],
            signingSecretConfigured: true,
          },
          test: {
            curlCommand: [
              `curl -X POST "${webhookUrl}"`,
              `-H "Content-Type: application/json"`,
              `-H "X-Slack-Request-Timestamp: $(date +%s)"`,
              `-H "X-Slack-Signature: v0=$(date +%s)"`,
              `-d '{"type":"event_callback","event":{"type":"message","channel":"C0123456789","user":"U0123456789","text":"Hello from Slack!","ts":"1234567890.123456"},"team_id":"T0123456789"}'`,
            ].join(' \\\n'),
            samplePayload: {
              type: 'event_callback',
              token: 'XXYYZZ',
              team_id: 'T123ABC',
              event: {
                type: 'message',
                user: 'U123ABC',
                text: 'Hello from Slack!',
                ts: '1234567890.1234',
              },
              event_id: 'Ev123ABC',
            },
          },
        })
      }

      // Add the Airtable test case
      case 'airtable': {
        const baseId = providerConfig.baseId
        const tableId = providerConfig.tableId
        const webhookSecret = providerConfig.webhookSecret

        if (!baseId || !tableId) {
          logger.warn(`[${requestId}] Airtable webhook missing Base ID or Table ID: ${webhookId}`)
          return NextResponse.json(
            {
              success: false,
              error: 'Webhook configuration is incomplete (missing Base ID or Table ID)',
            },
            { status: 400 }
          )
        }

        // Define a sample payload structure
        const samplePayload = {
          webhook: {
            id: 'whiYOUR_WEBHOOK_ID',
          },
          base: {
            id: baseId,
          },
          payloadFormat: 'v0',
          actionMetadata: {
            source: 'tableOrViewChange', // Example source
            sourceMetadata: {},
          },
          payloads: [
            {
              timestamp: new Date().toISOString(),
              baseTransactionNumber: Date.now(), // Example transaction number
              changedTablesById: {
                [tableId]: {
                  // Example changes - structure may vary based on actual event
                  changedRecordsById: {
                    recSAMPLEID1: {
                      current: { cellValuesByFieldId: { fldSAMPLEID: 'New Value' } },
                      previous: { cellValuesByFieldId: { fldSAMPLEID: 'Old Value' } },
                    },
                  },
                  changedFieldsById: {},
                  changedViewsById: {},
                },
              },
            },
          ],
        }

        // Generate sample curl command
        let curlCommand = `curl -X POST "${webhookUrl}" -H "Content-Type: application/json"`
        curlCommand += ` -d '${JSON.stringify(samplePayload, null, 2)}'`

        logger.info(`[${requestId}] Airtable webhook test successful: ${webhookId}`)
        return NextResponse.json({
          success: true,
          webhook: {
            id: foundWebhook.id,
            url: webhookUrl,
            baseId: baseId,
            tableId: tableId,
            secretConfigured: !!webhookSecret,
            isActive: foundWebhook.isActive,
          },
          message:
            'Airtable webhook configuration appears valid. Use the sample curl command to manually send a test payload to your webhook URL.',
          test: {
            curlCommand: curlCommand,
            samplePayload: samplePayload,
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
