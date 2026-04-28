import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  validateAlphanumericId,
  validateJiraCloudId,
  validateJiraIssueKey,
} from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getJiraCloudId, parseAtlassianErrorMessage } from '@/tools/jira/utils'
import { getJsmApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JsmRequestAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
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
      issueIdOrKey,
      serviceDeskId,
      requestTypeId,
      summary,
      description,
      raiseOnBehalfOf,
      requestFieldValues,
      formAnswers,
      requestParticipants,
      channel,
      expand,
    } = body

    if (!domain) {
      logger.error('Missing domain in request')
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      logger.error('Missing access token in request')
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    const cloudId = cloudIdParam || (await getJiraCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const baseUrl = getJsmApiBaseUrl(cloudId)

    const isCreateOperation = serviceDeskId && requestTypeId && (summary || formAnswers)

    if (isCreateOperation) {
      const serviceDeskIdValidation = validateAlphanumericId(serviceDeskId, 'serviceDeskId')
      if (!serviceDeskIdValidation.isValid) {
        return NextResponse.json({ error: serviceDeskIdValidation.error }, { status: 400 })
      }

      const requestTypeIdValidation = validateAlphanumericId(requestTypeId, 'requestTypeId')
      if (!requestTypeIdValidation.isValid) {
        return NextResponse.json({ error: requestTypeIdValidation.error }, { status: 400 })
      }
      const url = `${baseUrl}/request`

      logger.info('Creating request at:', { url, serviceDeskId, requestTypeId })

      const requestBody: Record<string, unknown> = {
        serviceDeskId,
        requestTypeId,
      }

      if (formAnswers && typeof formAnswers === 'object') {
        // When form answers are provided, use them as the primary data source.
        // Per Atlassian docs, fields linked to form questions must NOT also appear
        // in requestFieldValues — doing so causes a 400 error.
        requestBody.form = { answers: formAnswers }

        // Only include explicit requestFieldValues if the caller provided them
        // (they know which fields are safe to include alongside form answers).
        if (requestFieldValues && typeof requestFieldValues === 'object') {
          requestBody.requestFieldValues = requestFieldValues
        }
      } else if (summary || description || requestFieldValues) {
        const fieldValues =
          requestFieldValues && typeof requestFieldValues === 'object'
            ? {
                ...(!requestFieldValues.summary && summary ? { summary } : {}),
                ...(!requestFieldValues.description && description ? { description } : {}),
                ...requestFieldValues,
              }
            : {
                ...(summary && { summary }),
                ...(description && { description }),
              }
        requestBody.requestFieldValues = fieldValues
      }

      if (raiseOnBehalfOf) {
        requestBody.raiseOnBehalfOf = raiseOnBehalfOf
      }
      if (requestParticipants) {
        requestBody.requestParticipants = Array.isArray(requestParticipants)
          ? requestParticipants
          : typeof requestParticipants === 'string'
            ? requestParticipants
                .split(',')
                .map((id: string) => id.trim())
                .filter(Boolean)
            : []
      }
      if (channel) {
        requestBody.channel = channel
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: getJsmHeaders(accessToken),
        body: JSON.stringify(requestBody),
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
          issueId: data.issueId,
          issueKey: data.issueKey,
          requestTypeId: data.requestTypeId,
          serviceDeskId: data.serviceDeskId,
          createdDate: data.createdDate ?? null,
          currentStatus: data.currentStatus
            ? {
                status: data.currentStatus.status ?? null,
                statusCategory: data.currentStatus.statusCategory ?? null,
                statusDate: data.currentStatus.statusDate ?? null,
              }
            : null,
          reporter: data.reporter
            ? {
                accountId: data.reporter.accountId ?? null,
                displayName: data.reporter.displayName ?? null,
                emailAddress: data.reporter.emailAddress ?? null,
              }
            : null,
          success: true,
          url: `https://${domain}/browse/${data.issueKey}`,
        },
      })
    }
    if (!issueIdOrKey) {
      logger.error('Missing issueIdOrKey in request')
      return NextResponse.json({ error: 'Issue ID or key is required' }, { status: 400 })
    }

    const issueIdOrKeyValidation = validateJiraIssueKey(issueIdOrKey, 'issueIdOrKey')
    if (!issueIdOrKeyValidation.isValid) {
      return NextResponse.json({ error: issueIdOrKeyValidation.error }, { status: 400 })
    }

    const params = new URLSearchParams()
    if (expand) params.append('expand', expand)

    const url = `${baseUrl}/request/${issueIdOrKey}${params.toString() ? `?${params.toString()}` : ''}`

    logger.info('Fetching request from:', url)

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
        issueId: data.issueId ?? null,
        issueKey: data.issueKey ?? null,
        requestTypeId: data.requestTypeId ?? null,
        serviceDeskId: data.serviceDeskId ?? null,
        createdDate: data.createdDate ?? null,
        currentStatus: data.currentStatus
          ? {
              status: data.currentStatus.status ?? null,
              statusCategory: data.currentStatus.statusCategory ?? null,
              statusDate: data.currentStatus.statusDate ?? null,
            }
          : null,
        reporter: data.reporter
          ? {
              accountId: data.reporter.accountId ?? null,
              displayName: data.reporter.displayName ?? null,
              emailAddress: data.reporter.emailAddress ?? null,
              active: data.reporter.active ?? true,
            }
          : null,
        requestFieldValues: (data.requestFieldValues ?? []).map((fv: Record<string, unknown>) => ({
          fieldId: fv.fieldId ?? null,
          label: fv.label ?? null,
          value: fv.value ?? null,
        })),
        url: `https://${domain}/browse/${data.issueKey}`,
        request: data,
      },
    })
  } catch (error) {
    logger.error('Error with request operation:', {
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
})
