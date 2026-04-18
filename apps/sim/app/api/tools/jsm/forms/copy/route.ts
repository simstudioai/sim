import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateJiraCloudId, validateJiraIssueKey } from '@/lib/core/security/input-validation'
import { getJiraCloudId, parseAtlassianErrorMessage } from '@/tools/jira/utils'
import { getJsmFormsApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JsmCopyFormsAPI')

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
      sourceIssueIdOrKey,
      targetIssueIdOrKey,
      formIds,
    } = body

    if (!domain) {
      logger.error('Missing domain in request')
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      logger.error('Missing access token in request')
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!sourceIssueIdOrKey) {
      logger.error('Missing sourceIssueIdOrKey in request')
      return NextResponse.json({ error: 'Source issue ID or key is required' }, { status: 400 })
    }

    if (!targetIssueIdOrKey) {
      logger.error('Missing targetIssueIdOrKey in request')
      return NextResponse.json({ error: 'Target issue ID or key is required' }, { status: 400 })
    }

    const cloudId = cloudIdParam || (await getJiraCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const sourceValidation = validateJiraIssueKey(sourceIssueIdOrKey, 'sourceIssueIdOrKey')
    if (!sourceValidation.isValid) {
      return NextResponse.json({ error: sourceValidation.error }, { status: 400 })
    }

    const targetValidation = validateJiraIssueKey(targetIssueIdOrKey, 'targetIssueIdOrKey')
    if (!targetValidation.isValid) {
      return NextResponse.json({ error: targetValidation.error }, { status: 400 })
    }

    const baseUrl = getJsmFormsApiBaseUrl(cloudId)
    const url = `${baseUrl}/issue/${encodeURIComponent(sourceIssueIdOrKey)}/form/copy/${encodeURIComponent(targetIssueIdOrKey)}`

    if (formIds !== undefined && !Array.isArray(formIds)) {
      return NextResponse.json({ error: 'formIds must be an array of form UUIDs' }, { status: 400 })
    }

    const requestBody = Array.isArray(formIds) && formIds.length > 0 ? { ids: formIds } : {}

    logger.info('Copying forms:', { url, sourceIssueIdOrKey, targetIssueIdOrKey, formIds })

    const response = await fetch(url, {
      method: 'POST',
      headers: getJsmHeaders(accessToken),
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('JSM Forms API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })

      return NextResponse.json(
        {
          error: parseAtlassianErrorMessage(response.status, response.statusText, errorText),
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
        sourceIssueIdOrKey,
        targetIssueIdOrKey,
        copiedForms: data.copiedForms ?? [],
        errors: data.errors ?? [],
      },
    })
  } catch (error) {
    logger.error('Error copying forms:', {
      error: toError(error).message,
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
