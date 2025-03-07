import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '@/db'
import { webhook, workflow } from '@/db/schema'
import { Executor } from '@/executor'
import { SerializedWorkflow } from '@/serializer/types'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Handle WhatsApp webhook verification
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  // Your verification token should be stored securely (e.g., in environment variables)
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WhatsApp webhook verified')
    return new NextResponse(challenge, { status: 200 })
  }

  return new NextResponse('Verification failed', { status: 403 })
}

export async function POST(request: NextRequest) {
  try {
    // Parse the incoming webhook payload
    const body = await request.json()

    // Extract the WhatsApp message data
    const data = body?.entry?.[0]?.changes?.[0]?.value

    if (!data) {
      return new NextResponse('No data received', { status: 400 })
    }

    // Extract message details
    const messages = data.messages || []

    if (messages.length === 0) {
      // This might be a different type of notification (e.g., status update)
      return new NextResponse('No messages in payload', { status: 200 })
    }

    // Find all active WhatsApp webhooks
    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: workflow,
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(
        and(
          eq(webhook.provider, 'whatsapp'),
          eq(webhook.isActive, true),
          eq(workflow.isDeployed, true)
        )
      )

    if (webhooks.length === 0) {
      return new NextResponse('No active WhatsApp webhooks found', { status: 200 })
    }

    // Process each message
    for (const message of messages) {
      const phoneNumberId = data.metadata?.phone_number_id
      const from = message.from
      const messageId = message.id
      const timestamp = message.timestamp
      const text = message.text?.body

      console.log(`Received WhatsApp message: ${text} from ${from}`)

      // Execute each matching workflow with the WhatsApp message data
      for (const { webhook: wh, workflow: wf } of webhooks) {
        try {
          // Get the workflow state
          if (!wf.state) continue

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
                payload: body,
              },
            },
          }

          // Execute the workflow
          const executor = new Executor(wf.state as SerializedWorkflow, input)
          await executor.execute(wf.id)
        } catch (error) {
          console.error(`Error executing workflow ${wf.id}:`, error)
        }
      }
    }

    // Always return a 200 OK to WhatsApp
    return new NextResponse('OK', { status: 200 })
  } catch (error) {
    console.error('Error processing WhatsApp webhook:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
