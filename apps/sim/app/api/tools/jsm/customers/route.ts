import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { jsmCustomersContract } from '@/lib/api/contracts/selectors/jsm'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getJiraCloudId, parseAtlassianErrorMessage } from '@/tools/jira/utils'
import { getJsmApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JsmCustomersAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(jsmCustomersContract, request, {})
    if (!parsed.success) return parsed.response

    const {
      domain,
      accessToken,
      cloudId: cloudIdParam,
      serviceDeskId,
      query,
      start,
      limit,
      accountIds,
      emails,
    } = parsed.data.body

    if (!domain) {
      logger.error('Missing domain in request')
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      logger.error('Missing access token in request')
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!serviceDeskId) {
      logger.error('Missing serviceDeskId in request')
      return NextResponse.json({ error: 'Service Desk ID is required' }, { status: 400 })
    }

    if (emails !== undefined) {
      return NextResponse.json(
        {
          error:
            'The `emails` parameter is no longer supported. Use `accountIds` (Atlassian account IDs) instead.',
        },
        { status: 400 }
      )
    }

    const cloudId = cloudIdParam || (await getJiraCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const serviceDeskIdValidation = validateAlphanumericId(serviceDeskId, 'serviceDeskId')
    if (!serviceDeskIdValidation.isValid) {
      return NextResponse.json({ error: serviceDeskIdValidation.error }, { status: 400 })
    }

    const baseUrl = getJsmApiBaseUrl(cloudId)

    const splitCsv = (value: unknown): string[] =>
      value
        ? typeof value === 'string'
          ? value
              .split(',')
              .map((v: string) => v.trim())
              .filter((v: string) => v)
          : Array.isArray(value)
            ? (value as string[])
            : []
        : []

    const parsedAccountIds = splitCsv(accountIds)

    if (parsedAccountIds.length > 0) {
      const url = `${baseUrl}/servicedesk/${serviceDeskId}/customer`

      logger.info('Adding customers to:', url, {
        accountIds: parsedAccountIds,
      })

      const response = await fetch(url, {
        method: 'POST',
        headers: getJsmHeaders(accessToken),
        body: JSON.stringify({ accountIds: parsedAccountIds }),
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

      return NextResponse.json({
        success: true,
        output: {
          ts: new Date().toISOString(),
          serviceDeskId,
          success: true,
        },
      })
    }
    const params = new URLSearchParams()
    if (query) params.append('query', query)
    if (start) params.append('start', start)
    if (limit) params.append('limit', limit)

    const url = `${baseUrl}/servicedesk/${serviceDeskId}/customer${params.toString() ? `?${params.toString()}` : ''}`

    logger.info('Fetching customers from:', url)

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
        customers: data.values || [],
        total: data.size || 0,
        isLastPage: data.isLastPage ?? true,
      },
    })
  } catch (error) {
    logger.error('Error with customers operation:', {
      error: toError(error).message,
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      {
        error: getErrorMessage(error, 'Internal server error'),
        success: false,
      },
      { status: 500 }
    )
  }
})
