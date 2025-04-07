import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { webhook, workflow } from '@/db/schema'

const logger = createLogger('WebhookTestAPI')

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = crypto.randomUUID().slice(0, 8)
  logger.debug(`[${requestId}] Testing webhook for ID: ${params.id}`)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized webhook test attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the webhook configuration
    const webhookId = params.id
    const webhookRecords = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          userId: workflow.userId,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(webhook.id, webhookId))
      .limit(1)

    if (webhookRecords.length === 0) {
      logger.warn(`[${requestId}] Webhook not found: ${webhookId}`)
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    const webhookRecord = webhookRecords[0]

    // Check ownership
    if (webhookRecord.workflow.userId !== session.user.id) {
      logger.warn(`[${requestId}] Unauthorized webhook test attempt by user ${session.user.id} for webhook owned by ${webhookRecord.workflow.userId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Get the provider config and webhook path
    const providerConfig = webhookRecord.webhook.providerConfig as any || {}
    const provider = webhookRecord.webhook.provider || 'generic'
    const webhookPath = webhookRecord.webhook.path
    
    // Get the origin for constructing test URLs
    const origin = request.headers.get('origin') || 'http://localhost:3000'
    
    // Create the main webhook trigger URL
    const triggerUrl = `${origin}/api/webhooks/trigger/${webhookPath}`

    // Provider-specific test information
    let testData = {}
    let testInstructions = ''
    let testCommands = {}
    let expectedResponse = 'OK'
    let formFields = []
    
    // Handle different providers
    switch (provider) {
      case 'twilio': {
        const sendReply = providerConfig?.sendReply !== false
        
        // Generate example curl commands for testing - with proper URL encoding
        const curlCommand = `curl -X POST "${triggerUrl}" \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  --data-urlencode "Body=Hello from Twilio" \\
  --data-urlencode "From=+12345678900" \\
  --data-urlencode "To=+10987654321" \\
  --data-urlencode "MessageSid=SM$(openssl rand -hex 16)" \\
  --data-urlencode "AccountSid=AC$(openssl rand -hex 16)" \\
  --data-urlencode "NumMedia=0"`

        // Create a sample TwiML response
        expectedResponse = sendReply
          ? `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Thank you for your message: "Hello from Twilio". Your request is being processed.</Message>
</Response>`
          : `<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`

        // Create a comprehensive step-by-step guide for testing with ngrok
        const ngrokTips = `
## Testing with ngrok

1. Start ngrok in your terminal: 
   \`ngrok http 3000\`

2. Copy the HTTPS URL that ngrok provides (e.g., https://xxxx-xxxx.ngrok-free.app)

3. In your Twilio dashboard:
   a. Navigate to Phone Numbers > Manage > Active Numbers
   b. Click on your phone number
   c. Scroll down to "Messaging" section
   d. Under "A MESSAGE COMES IN", select "Webhook" and paste:
      \`${triggerUrl.replace(origin, '{NGROK_URL}')}\`
   e. Make sure HTTP POST is selected
   f. Click Save

4. Send a test message to your Twilio phone number

5. Check your application logs for incoming requests

Remember: Update the webhook URL in Twilio whenever you restart ngrok, as the URL changes with each session unless you have a paid ngrok plan.
`

        // Create a troubleshooting section
        const troubleshooting = `
## Troubleshooting

If you're not receiving webhooks:

1. Verify ngrok is running and the URL is current in Twilio
2. Check Twilio logs in your dashboard under Monitor > Logs > Messaging
3. Ensure your Twilio phone number is properly configured for messaging
4. Try the curl command above to test the endpoint directly
5. Check your application logs for any errors

Common issues:
- Content type mismatch (Twilio sends application/x-www-form-urlencoded)
- Missing or incorrect URL in Twilio dashboard
- Network/firewall issues blocking incoming webhooks
- Expired ngrok session
`
        
        // List of form fields that Twilio typically sends
        formFields = [
          { name: 'Body', description: 'The text of the message' },
          { name: 'From', description: 'The phone number that sent the message' },
          { name: 'To', description: 'The Twilio phone number that received the message' },
          { name: 'MessageSid', description: 'A unique string that identifies the message' },
          { name: 'AccountSid', description: 'Your Twilio account identifier' },
          { name: 'NumMedia', description: 'The number of media items associated with the message' },
          { name: 'SmsMessageSid', description: 'Same as MessageSid for SMS messages' },
          { name: 'SmsSid', description: 'Same as MessageSid for SMS messages' },
          { name: 'SmsStatus', description: 'The status of the message (e.g., received)' },
          { name: 'FromCity', description: 'The city of the sender' },
          { name: 'FromState', description: 'The state or province of the sender' },
          { name: 'FromZip', description: 'The postal code of the sender' },
          { name: 'FromCountry', description: 'The country of the sender' },
          { name: 'ToCity', description: 'The city of the recipient' },
          { name: 'ToState', description: 'The state or province of the recipient' },
          { name: 'ToZip', description: 'The postal code of the recipient' },
          { name: 'ToCountry', description: 'The country of the recipient' },
        ]
        
        testData = {
          curl: curlCommand,
          ngrokInstructions: ngrokTips,
          troubleshooting: troubleshooting,
          formFields: formFields,
          expectedResponse: expectedResponse,
          tip: "For quick testing, use the curl command above to simulate Twilio sending an SMS to your webhook. For real testing, configure your Twilio phone number to use the webhook URL with ngrok."
        }
        
        break
      }
      
      case 'slack': {
        // Slack-specific test data and instructions
        const curlCommand = `curl -X POST "${triggerUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"event_callback","event":{"type":"message","text":"Hello from Slack","user":"U1234567890","channel":"C1234567890","ts":"1234567890.123456"}}'`
        
        testData = {
          curl: curlCommand,
          tip: "Configure your Slack app to send events to the webhook URL to receive messages."
        }
        
        break
      }
      
      case 'whatsapp': {
        // WhatsApp-specific test data and instructions
        const curlCommand = `curl -X POST "${triggerUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"object":"whatsapp_business_account","entry":[{"id":"123456789","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"1234567890","phone_number_id":"1234567890"},"contacts":[{"profile":{"name":"Test User"},"wa_id":"1234567890"}],"messages":[{"from":"1234567890","id":"wamid.ABC123","timestamp":"1234567890","text":{"body":"Hello from WhatsApp"},"type":"text"}]},"field":"messages"}]}]}'`
        
        testData = {
          curl: curlCommand,
          tip: "Configure your WhatsApp Business API to send events to the webhook URL."
        }
        
        break
      }
      
      default: {
        // Generic webhook test data and instructions
        const curlCommand = `curl -X POST "${triggerUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"message":"Hello from webhook test","timestamp":"${new Date().toISOString()}"}'`
        
        testData = {
          curl: curlCommand,
          tip: "Use the curl command above to test your webhook or configure your service to send requests to the webhook URL."
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Here are the details for testing your ${provider} webhook:`,
      webhook: {
        id: webhookId,
        path: webhookPath,
        provider: provider,
        providerConfig: providerConfig
      },
      testing: {
        url: triggerUrl,
        ...testData
      }
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error testing webhook:`, error)
    return NextResponse.json(
      { error: 'An error occurred while testing the webhook', message: error.message },
      { status: 500 }
    )
  }
} 