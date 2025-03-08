import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '@/db'
import { webhook, workflow } from '@/db/schema'
import { Executor } from '@/executor'
import { SerializedWorkflow } from '@/serializer/types'

export const dynamic = 'force-dynamic'

/**
 * WhatsApp webhook endpoint
 * This follows the exact pattern in the WhatsApp sample app
 * https://developers.facebook.com/docs/whatsapp/sample-app-endpoints
 */

export async function GET(request: NextRequest) {
  try {
    // Log the full request details for debugging
    const url = new URL(request.url)
    const searchParams = Object.fromEntries(url.searchParams.entries())
    console.log('WhatsApp webhook GET request received:', {
      url: url.toString(),
      params: searchParams,
      headers: Object.fromEntries(request.headers.entries()),
    })

    // Get the verification parameters
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    console.log('WhatsApp verification parameters:', {
      mode,
      tokenProvided: Boolean(token),
      challengeProvided: Boolean(challenge),
    })

    // Validate the verification parameters
    if (!mode || !token || !challenge) {
      console.log('Missing verification parameters')
      return new NextResponse('Missing verification parameters', { status: 400 })
    }

    if (mode !== 'subscribe') {
      console.log('Invalid mode:', mode)
      return new NextResponse('Invalid mode', { status: 400 })
    }

    // Find all active WhatsApp webhooks
    const webhooks = await db
      .select()
      .from(webhook)
      .where(and(eq(webhook.provider, 'whatsapp'), eq(webhook.isActive, true)))

    console.log(`Found ${webhooks.length} active WhatsApp webhooks`)

    // Check if any webhook has a matching verification token
    for (const wh of webhooks) {
      const providerConfig = (wh.providerConfig as Record<string, any>) || {}
      const verificationToken = providerConfig.verificationToken

      if (!verificationToken) {
        console.log(`Webhook ${wh.id} has no verification token, skipping`)
        continue
      }

      console.log(`Checking webhook ${wh.id} with token ${verificationToken.substring(0, 2)}***`)

      if (token === verificationToken) {
        console.log(
          `Verification successful for webhook ${wh.id}, returning challenge: ${challenge}`
        )
        // Return ONLY the challenge as plain text (exactly as WhatsApp expects)
        return new NextResponse(challenge, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
          },
        })
      }
    }

    console.log('No matching verification token found')
    return new NextResponse('Verification failed', { status: 403 })
  } catch (error: any) {
    console.error('Error processing WhatsApp webhook verification:', error)
    return new NextResponse(`Internal Server Error: ${error.message}`, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('WhatsApp webhook POST request received')

    // Parse the request body
    const body = await request.json().catch(() => ({}))
    console.log('WhatsApp webhook payload:', JSON.stringify(body).substring(0, 200) + '...')

    // Find all active WhatsApp webhooks
    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: workflow,
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(and(eq(webhook.provider, 'whatsapp'), eq(webhook.isActive, true)))

    if (webhooks.length === 0) {
      console.log('No active WhatsApp webhooks found')
      return new NextResponse('No active WhatsApp webhooks found', { status: 200 })
    }

    console.log(`Found ${webhooks.length} active WhatsApp webhooks`)

    // Extract the WhatsApp message data
    const data = body?.entry?.[0]?.changes?.[0]?.value

    if (!data) {
      console.log('No data received in WhatsApp webhook')
      return new NextResponse('OK', { status: 200 })
    }

    // Extract message details
    const messages = data.messages || []

    if (messages.length === 0) {
      // This might be a different type of notification (e.g., status update)
      console.log('No messages in WhatsApp payload, might be a status update')
      return new NextResponse('OK', { status: 200 })
    }

    // Process each message
    for (const message of messages) {
      const phoneNumberId = data.metadata?.phone_number_id
      const from = message.from
      const messageId = message.id
      const timestamp = message.timestamp
      const text = message.text?.body

      console.log(
        `Received WhatsApp message: ${text ? text.substring(0, 50) : '[no text]'} from ${from}`
      )

      // Execute each matching workflow with the WhatsApp message data
      for (const { webhook: wh, workflow: wf } of webhooks) {
        try {
          // Get the workflow state
          if (!wf.state) {
            console.log(`Workflow ${wf.id} has no state, skipping`)
            continue
          }

          console.log(`Executing workflow ${wf.id} for WhatsApp message ${messageId}`)

          // Create input payload for the workflow
          const input = {
            whatsapp: {
              data: {
                messageId,
                from,
                phoneNumberId,
                text,
                timestamp,
                raw: message,
              },
            },
            webhook: {
              data: {
                provider: 'whatsapp',
                path: wh.path,
                providerConfig: wh.providerConfig,
                payload: body,
                headers: Object.fromEntries(request.headers.entries()),
                method: request.method,
              },
            },
          }

          // Execute the workflow
          const executor = new Executor(wf.state as SerializedWorkflow, input)
          await executor.execute(wf.id)
          console.log(`Successfully executed workflow ${wf.id}`)
        } catch (error) {
          console.error(`Error executing workflow ${wf.id}:`, error)
        }
      }
    }

    // Always return a 200 OK to WhatsApp
    return new NextResponse('OK', { status: 200 })
  } catch (error: any) {
    console.error('Error processing WhatsApp webhook:', error)
    // Still return 200 to prevent WhatsApp from retrying
    return new NextResponse('OK', { status: 200 })
  }
}
