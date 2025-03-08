import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { webhook } from '@/db/schema'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Get the webhook ID from the query parameters
    const { searchParams } = new URL(request.url)
    const webhookId = searchParams.get('id')

    if (!webhookId) {
      return NextResponse.json({ success: false, error: 'Webhook ID is required' }, { status: 400 })
    }

    // Find the webhook in the database
    const webhooks = await db
      .select()
      .from(webhook)
      .where(and(eq(webhook.id, webhookId), eq(webhook.provider, 'stripe')))
      .limit(1)

    if (webhooks.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Stripe webhook not found' },
        { status: 404 }
      )
    }

    const foundWebhook = webhooks[0]

    // Construct the webhook URL
    const baseUrl = new URL(request.url).origin
    const webhookUrl = `${baseUrl}/api/webhooks/trigger/${foundWebhook.path}`

    // Return the webhook information
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
        events: ['charge.succeeded', 'invoice.payment_succeeded', 'customer.subscription.created'],
      },
    })
  } catch (error: any) {
    console.error('Error testing Stripe webhook:', error)
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
