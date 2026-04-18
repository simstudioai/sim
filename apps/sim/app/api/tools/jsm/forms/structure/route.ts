import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateJiraCloudId, validateJiraIssueKey } from '@/lib/core/security/input-validation'
import { getJiraCloudId, parseAtlassianErrorMessage } from '@/tools/jira/utils'
import { getJsmFormsApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JsmFormStructureAPI')

export async function POST(request: NextRequest) {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { domain, accessToken, cloudId: cloudIdParam, projectIdOrKey, formId } = body

    if (!domain) {
      logger.error('Missing domain in request')
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      logger.error('Missing access token in request')
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!projectIdOrKey) {
      logger.error('Missing projectIdOrKey in request')
      return NextResponse.json({ error: 'Project ID or key is required' }, { status: 400 })
    }

    if (!formId) {
      logger.error('Missing formId in request')
      return NextResponse.json({ error: 'Form ID is required' }, { status: 400 })
    }

    const cloudId = cloudIdParam || (await getJiraCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const projectIdOrKeyValidation = validateJiraIssueKey(projectIdOrKey, 'projectIdOrKey')
    if (!projectIdOrKeyValidation.isValid) {
      return NextResponse.json({ error: projectIdOrKeyValidation.error }, { status: 400 })
    }

    const formIdValidation = validateJiraCloudId(formId, 'formId')
    if (!formIdValidation.isValid) {
      return NextResponse.json({ error: formIdValidation.error }, { status: 400 })
    }

    const baseUrl = getJsmFormsApiBaseUrl(cloudId)
    const url = `${baseUrl}/project/${encodeURIComponent(projectIdOrKey)}/form/${encodeURIComponent(formId)}`

    logger.info('Fetching form template from:', { url, projectIdOrKey, formId })

    const response = await fetch(url, {
      method: 'GET',
      headers: getJsmHeaders(accessToken),
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
        projectIdOrKey,
        formId,
        design: data.design ?? null,
        updated: data.updated ?? null,
        publish: data.publish ?? null,
      },
    })
  } catch (error) {
    logger.error('Error fetching form structure:', {
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
