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
      .where(and(eq(webhook.id, webhookId), eq(webhook.provider, 'whatsapp')))
      .limit(1)

    if (webhooks.length === 0) {
      return NextResponse.json({ success: false, error: 'Webhook not found' }, { status: 404 })
    }

    const foundWebhook = webhooks[0]
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
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
    const baseUrl = new URL(request.url).origin
    const whatsappUrl = `${baseUrl}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${verificationToken}&hub.challenge=${challenge}`

    console.log('Testing WhatsApp webhook:', {
      webhookId,
      url: whatsappUrl,
      token: verificationToken ? verificationToken.substring(0, 3) + '***' : null,
    })

    // Make a request to the WhatsApp webhook endpoint
    const response = await fetch(whatsappUrl, {
      headers: {
        'User-Agent': 'facebookplatform/1.0',
      },
    })

    // Get the response details
    const status = response.status
    const contentType = response.headers.get('content-type')
    const responseText = await response.text()

    console.log('WhatsApp test response:', {
      status,
      contentType,
      responseText,
    })

    // Check if the test was successful
    const success = status === 200 && responseText === challenge

    // Return the test results
    return NextResponse.json({
      success,
      webhook: {
        id: foundWebhook.id,
        url: `${baseUrl}/api/webhooks/whatsapp`,
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
  } catch (error: any) {
    console.error('Error testing WhatsApp webhook:', error)
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
