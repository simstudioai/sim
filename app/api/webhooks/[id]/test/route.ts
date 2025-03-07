import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { webhook, workflow } from '@/db/schema'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Find the webhook and check ownership
    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          name: workflow.name,
          userId: workflow.userId,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(webhook.id, params.id))
      .limit(1)

    if (webhooks.length === 0) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    if (webhooks[0].workflow.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const foundWebhook = webhooks[0].webhook
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}

    // Create a test payload based on the webhook provider
    let testPayload = {}

    switch (foundWebhook.provider) {
      case 'whatsapp':
        testPayload = {
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: {
                      phone_number_id: '123456789',
                    },
                    messages: [
                      {
                        from: '9876543210',
                        id: 'test-message-id',
                        timestamp: new Date().toISOString(),
                        text: {
                          body: 'This is a test message from the webhook test endpoint',
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        }
        break
      case 'github':
        testPayload = {
          action: 'test',
          repository: {
            full_name: 'user/repo',
          },
          sender: {
            login: 'testuser',
          },
        }
        break
      case 'stripe':
        testPayload = {
          id: 'evt_test',
          type: 'test.webhook',
          created: Math.floor(Date.now() / 1000),
          data: {
            object: {
              id: 'test_obj_123',
            },
          },
        }
        break
      default:
        testPayload = {
          event: 'test',
          timestamp: new Date().toISOString(),
          data: {
            message: 'This is a test webhook event',
          },
        }
    }

    // Make a request to the webhook trigger endpoint
    const baseUrl = new URL(request.url).origin
    const webhookPath = foundWebhook.path.startsWith('/')
      ? foundWebhook.path
      : `/${foundWebhook.path}`
    const triggerUrl = `${baseUrl}/api/webhooks/trigger${webhookPath}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Add provider-specific headers
    if (foundWebhook.provider === 'whatsapp' && providerConfig.verificationToken) {
      // For WhatsApp, we don't need to add any headers for the test
    } else if (foundWebhook.provider === 'github' && providerConfig.contentType) {
      headers['Content-Type'] = providerConfig.contentType
    } else if (providerConfig.token) {
      // For generic webhooks with a token
      headers['Authorization'] = `Bearer ${providerConfig.token}`
    }

    try {
      const response = await fetch(triggerUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(testPayload),
      })

      const responseData = await response.json().catch(() => ({}))

      return NextResponse.json({
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        data: responseData,
      })
    } catch (error: any) {
      return NextResponse.json({
        success: false,
        error: error.message || 'Failed to trigger webhook',
      })
    }
  } catch (error: any) {
    console.error('Error testing webhook:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
