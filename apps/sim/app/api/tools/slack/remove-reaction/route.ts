import { type NextRequest, NextResponse } from 'next/server'
import { slackRemoveReactionContract } from '@/lib/api/contracts/tools/communication/slack'
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

    const parsed = await parseRequest(slackRemoveReactionContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    const slackResponse = await fetch('https://slack.com/api/reactions.remove', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validatedData.accessToken}`,
      },
      body: JSON.stringify({
        channel: validatedData.channel,
        timestamp: validatedData.timestamp,
        name: validatedData.name,
      }),
    })

    const data = await slackResponse.json()

    if (!data.ok) {
      return NextResponse.json(
        {
          success: false,
          error: data.error || 'Failed to remove reaction',
        },
        { status: slackResponse.status }
      )
    }

    return NextResponse.json({
      success: true,
      output: {
        content: `Successfully removed :${validatedData.name}: reaction`,
        metadata: {
          channel: validatedData.channel,
          timestamp: validatedData.timestamp,
          reaction: validatedData.name,
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
