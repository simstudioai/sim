import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  validateEnum,
  validateJiraCloudId,
  validateJiraIssueKey,
} from '@/lib/core/security/input-validation'
import { getJiraCloudId, getJsmApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JsmFeedbackAPI')

const VALID_ACTIONS = ['get', 'add', 'delete'] as const

export async function POST(request: NextRequest) {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const {
      domain,
      accessToken,
      cloudId: cloudIdParam,
      action,
      issueIdOrKey,
      rating,
      comment,
    } = body

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

    if (!action) {
      logger.error('Missing action in request')
      return NextResponse.json({ error: 'Action is required' }, { status: 400 })
    }

    const actionValidation = validateEnum(action, VALID_ACTIONS, 'action')
    if (!actionValidation.isValid) {
      return NextResponse.json({ error: actionValidation.error }, { status: 400 })
    }

    const issueIdOrKeyValidation = validateJiraIssueKey(issueIdOrKey, 'issueIdOrKey')
    if (!issueIdOrKeyValidation.isValid) {
      return NextResponse.json({ error: issueIdOrKeyValidation.error }, { status: 400 })
    }

    const cloudId = cloudIdParam || (await getJiraCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const baseUrl = getJsmApiBaseUrl(cloudId)
    const url = `${baseUrl}/request/${issueIdOrKey}/feedback`

    if (action === 'get') {
      logger.info('Fetching feedback from:', url)

      const response = await fetch(url, {
        method: 'GET',
        headers: getJsmHeaders(accessToken),
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('JSM API error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        })

        return NextResponse.json(
          {
            error: `JSM API error: ${response.status} ${response.statusText}`,
            details: errorText,
          },
          { status: response.status }
        )
      }

      const data = await response.json()

      return NextResponse.json({
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueIdOrKey,
          rating: data.rating ?? null,
          comment: data.comment?.body ?? null,
          type: data.type ?? null,
        },
      })
    }

    if (action === 'add') {
      if (rating === undefined || rating === null) {
        logger.error('Missing rating in request')
        return NextResponse.json({ error: 'Rating is required (1-5)' }, { status: 400 })
      }

      logger.info('Adding feedback to:', url, { rating })

      const feedbackBody: Record<string, unknown> = {
        rating: Number(rating),
        type: 'csat',
      }

      if (comment) {
        feedbackBody.comment = { body: comment }
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: getJsmHeaders(accessToken),
        body: JSON.stringify(feedbackBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('JSM API error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        })

        return NextResponse.json(
          {
            error: `JSM API error: ${response.status} ${response.statusText}`,
            details: errorText,
          },
          { status: response.status }
        )
      }

      const data = await response.json()

      return NextResponse.json({
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueIdOrKey,
          rating: data.rating ?? Number(rating),
          comment: data.comment?.body ?? comment ?? null,
          type: data.type ?? 'csat',
          success: true,
        },
      })
    }

    if (action === 'delete') {
      logger.info('Deleting feedback from:', url)

      const response = await fetch(url, {
        method: 'DELETE',
        headers: getJsmHeaders(accessToken),
      })

      if (response.status === 204 || response.ok) {
        return NextResponse.json({
          success: true,
          output: {
            ts: new Date().toISOString(),
            issueIdOrKey,
            success: true,
          },
        })
      }

      const errorText = await response.text()
      logger.error('JSM API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })

      return NextResponse.json(
        {
          error: `JSM API error: ${response.status} ${response.statusText}`,
          details: errorText,
        },
        { status: response.status }
      )
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error('Error in feedback operation:', {
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
