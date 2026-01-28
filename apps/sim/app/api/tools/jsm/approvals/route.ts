import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  validateAlphanumericId,
  validateEnum,
  validateJiraCloudId,
  validateJiraIssueKey,
} from '@/lib/core/security/input-validation'
import { getJiraCloudId, getJsmApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JsmApprovalsAPI')

const VALID_ACTIONS = ['get', 'answer'] as const
const VALID_DECISIONS = ['approve', 'decline'] as const

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
      approvalId,
      decision,
      start,
      limit,
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

    const cloudId = cloudIdParam || (await getJiraCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const issueIdOrKeyValidation = validateJiraIssueKey(issueIdOrKey, 'issueIdOrKey')
    if (!issueIdOrKeyValidation.isValid) {
      return NextResponse.json({ error: issueIdOrKeyValidation.error }, { status: 400 })
    }

    const baseUrl = getJsmApiBaseUrl(cloudId)

    if (action === 'get') {
      const params = new URLSearchParams()
      if (start) params.append('start', start)
      if (limit) params.append('limit', limit)

      const url = `${baseUrl}/request/${issueIdOrKey}/approval${params.toString() ? `?${params.toString()}` : ''}`

      logger.info('Fetching approvals from:', url)

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
          { error: `JSM API error: ${response.status} ${response.statusText}`, details: errorText },
          { status: response.status }
        )
      }

      const data = await response.json()

      return NextResponse.json({
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueIdOrKey,
          approvals: data.values || [],
          total: data.size || 0,
          isLastPage: data.isLastPage ?? true,
        },
      })
    }
    if (action === 'answer') {
      if (!approvalId) {
        logger.error('Missing approvalId in request')
        return NextResponse.json({ error: 'Approval ID is required' }, { status: 400 })
      }

      const approvalIdValidation = validateAlphanumericId(approvalId, 'approvalId')
      if (!approvalIdValidation.isValid) {
        return NextResponse.json({ error: approvalIdValidation.error }, { status: 400 })
      }

      const decisionValidation = validateEnum(decision, VALID_DECISIONS, 'decision')
      if (!decisionValidation.isValid) {
        return NextResponse.json({ error: decisionValidation.error }, { status: 400 })
      }

      const url = `${baseUrl}/request/${issueIdOrKey}/approval/${approvalId}`

      logger.info('Answering approval:', { issueIdOrKey, approvalId, decision })

      const response = await fetch(url, {
        method: 'POST',
        headers: getJsmHeaders(accessToken),
        body: JSON.stringify({ decision }),
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

      const data = await response.json()

      return NextResponse.json({
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueIdOrKey,
          approvalId,
          decision,
          success: true,
          approval: data,
        },
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error('Error in approvals operation:', {
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
