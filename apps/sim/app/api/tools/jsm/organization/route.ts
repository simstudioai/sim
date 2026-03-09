import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  validateAlphanumericId,
  validateEnum,
  validateJiraCloudId,
} from '@/lib/core/security/input-validation'
import { getJiraCloudId, getJsmApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JsmOrganizationAPI')

const VALID_ACTIONS = ['create', 'add_to_service_desk'] as const

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
      name,
      serviceDeskId,
      organizationId,
    } = body

    if (!domain) {
      logger.error('Missing domain in request')
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      logger.error('Missing access token in request')
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
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

    const baseUrl = getJsmApiBaseUrl(cloudId)

    if (action === 'create') {
      if (!name) {
        logger.error('Missing organization name in request')
        return NextResponse.json({ error: 'Organization name is required' }, { status: 400 })
      }

      const url = `${baseUrl}/organization`

      logger.info('Creating organization:', { name })

      const response = await fetch(url, {
        method: 'POST',
        headers: getJsmHeaders(accessToken),
        body: JSON.stringify({ name }),
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
          organizationId: data.id,
          name: data.name,
          success: true,
        },
      })
    }
    if (action === 'add_to_service_desk') {
      if (!serviceDeskId) {
        logger.error('Missing serviceDeskId in request')
        return NextResponse.json({ error: 'Service Desk ID is required' }, { status: 400 })
      }

      if (!organizationId) {
        logger.error('Missing organizationId in request')
        return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 })
      }

      const serviceDeskIdValidation = validateAlphanumericId(serviceDeskId, 'serviceDeskId')
      if (!serviceDeskIdValidation.isValid) {
        return NextResponse.json({ error: serviceDeskIdValidation.error }, { status: 400 })
      }

      const organizationIdValidation = validateAlphanumericId(organizationId, 'organizationId')
      if (!organizationIdValidation.isValid) {
        return NextResponse.json({ error: organizationIdValidation.error }, { status: 400 })
      }

      const url = `${baseUrl}/servicedesk/${serviceDeskId}/organization`

      logger.info('Adding organization to service desk:', { serviceDeskId, organizationId })

      const response = await fetch(url, {
        method: 'POST',
        headers: getJsmHeaders(accessToken),
        body: JSON.stringify({ organizationId: Number.parseInt(organizationId, 10) }),
      })

      if (response.status === 204 || response.ok) {
        return NextResponse.json({
          success: true,
          output: {
            ts: new Date().toISOString(),
            serviceDeskId,
            organizationId,
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
        { error: `JSM API error: ${response.status} ${response.statusText}`, details: errorText },
        { status: response.status }
      )
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error('Error in organization operation:', {
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
