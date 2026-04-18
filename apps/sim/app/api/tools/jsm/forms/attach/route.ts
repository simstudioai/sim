import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateJiraCloudId, validateJiraIssueKey } from '@/lib/core/security/input-validation'
import { toError } from '@/lib/core/utils/helpers'
import { getJiraCloudId, parseAtlassianErrorMessage } from '@/tools/jira/utils'
import { getJsmFormsApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JsmAttachFormAPI')

export async function POST(request: NextRequest) {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { domain, accessToken, cloudId: cloudIdParam, issueIdOrKey, formTemplateId } = body

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

    if (!formTemplateId) {
      logger.error('Missing formTemplateId in request')
      return NextResponse.json({ error: 'Form template ID is required' }, { status: 400 })
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

    const formTemplateIdValidation = validateJiraCloudId(formTemplateId, 'formTemplateId')
    if (!formTemplateIdValidation.isValid) {
      return NextResponse.json({ error: formTemplateIdValidation.error }, { status: 400 })
    }

    const baseUrl = getJsmFormsApiBaseUrl(cloudId)
    const url = `${baseUrl}/issue/${encodeURIComponent(issueIdOrKey)}/form`

    logger.info('Attaching form to issue:', { url, issueIdOrKey, formTemplateId })

    const response = await fetch(url, {
      method: 'POST',
      headers: getJsmHeaders(accessToken),
      body: JSON.stringify({
        formTemplate: { id: formTemplateId },
      }),
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
        issueIdOrKey,
        id: data.id ?? null,
        name: data.name ?? null,
        updated: data.updated ?? null,
        submitted: data.submitted ?? false,
        lock: data.lock ?? false,
        internal: data.internal ?? null,
        formTemplateId: (data.formTemplate as Record<string, unknown>)?.id ?? null,
      },
    })
  } catch (error) {
    logger.error('Error attaching form:', {
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
