import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { getJiraCloudId, getJsmApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JsmTransitionAPI')

export async function POST(request: Request) {
  try {
    const {
      domain,
      accessToken,
      cloudId: providedCloudId,
      issueIdOrKey,
      transitionId,
      comment,
    } = await request.json()

    if (!domain) {
      logger.error('Missing domain in request')
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      logger.error('Missing access token in request')
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!issueIdOrKey) {
      logger.error('Missing issueIdOrKey in request')
      return NextResponse.json({ error: 'Issue ID or key is required' }, { status: 400 })
    }

    if (!transitionId) {
      logger.error('Missing transitionId in request')
      return NextResponse.json({ error: 'Transition ID is required' }, { status: 400 })
    }

    const cloudId = providedCloudId || (await getJiraCloudId(domain, accessToken))
    const baseUrl = getJsmApiBaseUrl(cloudId)

    const url = `${baseUrl}/request/${issueIdOrKey}/transition`

    logger.info('Transitioning request at:', url)

    const body: Record<string, unknown> = {
      id: transitionId,
    }

    if (comment) {
      body.additionalComment = {
        body: comment,
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: getJsmHeaders(accessToken),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('JSM API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })

      return NextResponse.json(
        { error: `JSM API error: ${response.status} ${response.statusText}`, details: errorText },
        { status: response.status }
      )
    }

    return NextResponse.json({
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueIdOrKey,
        transitionId,
        success: true,
      },
    })
  } catch (error) {
    logger.error('Error transitioning request:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
        success: false,
      },
      { status: 500 }
    )
  }
}
