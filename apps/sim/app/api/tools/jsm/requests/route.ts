import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { getJiraCloudId, getJsmApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JsmRequestsAPI')

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
      requestOwnership,
      requestStatus,
      searchTerm,
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

    const cloudId = cloudIdParam || (await getJiraCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    if (serviceDeskId) {
      const serviceDeskIdValidation = validateAlphanumericId(serviceDeskId, 'serviceDeskId')
      if (!serviceDeskIdValidation.isValid) {
        return NextResponse.json({ error: serviceDeskIdValidation.error }, { status: 400 })
      }
    }

    const baseUrl = getJsmApiBaseUrl(cloudId)

    const params = new URLSearchParams()
    if (serviceDeskId) params.append('serviceDeskId', serviceDeskId)
    if (requestOwnership && requestOwnership !== 'ALL_REQUESTS') {
      params.append('requestOwnership', requestOwnership)
    }
    if (requestStatus && requestStatus !== 'ALL') {
      params.append('requestStatus', requestStatus)
    }
    if (searchTerm) params.append('searchTerm', searchTerm)
    if (start) params.append('start', start)
    if (limit) params.append('limit', limit)

    const url = `${baseUrl}/request${params.toString() ? `?${params.toString()}` : ''}`

    logger.info('Fetching requests from:', url)

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
        requests: data.values || [],
        total: data.size || 0,
        isLastPage: data.isLastPage ?? true,
      },
    })
  } catch (error) {
    logger.error('Error fetching requests:', {
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
