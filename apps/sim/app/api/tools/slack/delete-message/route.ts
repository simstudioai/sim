import { type NextRequest, NextResponse } from 'next/server'
import { slackDeleteMessageContract } from '@/lib/api/contracts/tools/communication/slack'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(slackDeleteMessageContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    const slackResponse = await fetch('https://slack.com/api/chat.delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validatedData.accessToken}`,
      },
      body: JSON.stringify({
        channel: validatedData.channel,
        ts: validatedData.timestamp,
      }),
    })

    const data = await slackResponse.json()

    if (!data.ok) {
      return NextResponse.json(
        {
          success: false,
          error: data.error || 'Failed to delete message',
        },
        { status: slackResponse.status }
      )
    }

    return NextResponse.json({
      success: true,
      output: {
        content: 'Message deleted successfully',
        metadata: {
          channel: data.channel,
          timestamp: data.ts,
        },
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
})
