import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { getJiraCloudId, getJsmApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JsmCustomersAPI')

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
      serviceDeskId,
      query,
      start,
      limit,
      emails,
    } = body

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

    const parsedEmails = emails
      ? typeof emails === 'string'
        ? emails
            .split(',')
            .map((email: string) => email.trim())
            .filter((email: string) => email)
        : emails
      : []

    const isAddOperation = parsedEmails.length > 0

    if (isAddOperation) {
      const url = `${baseUrl}/servicedesk/${serviceDeskId}/customer`

      logger.info('Adding customers to:', url, { emails: parsedEmails })

      const requestBody: Record<string, unknown> = {
        usernames: parsedEmails,
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
          { error: `JSM API error: ${response.status} ${response.statusText}`, details: errorText },
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
        { error: `JSM API error: ${response.status} ${response.statusText}`, details: errorText },
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
