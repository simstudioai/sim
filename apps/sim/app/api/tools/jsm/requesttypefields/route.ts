import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { getJiraCloudId, getJsmApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JsmRequestTypeFieldsAPI')

export async function POST(request: NextRequest) {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { domain, accessToken, cloudId: cloudIdParam, serviceDeskId, requestTypeId } = body

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

    if (!requestTypeId) {
      logger.error('Missing requestTypeId in request')
      return NextResponse.json({ error: 'Request Type ID is required' }, { status: 400 })
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

    const requestTypeIdValidation = validateAlphanumericId(requestTypeId, 'requestTypeId')
    if (!requestTypeIdValidation.isValid) {
      return NextResponse.json({ error: requestTypeIdValidation.error }, { status: 400 })
    }

    const baseUrl = getJsmApiBaseUrl(cloudId)
    const url = `${baseUrl}/servicedesk/${serviceDeskId}/requesttype/${requestTypeId}/field`

    logger.info('Fetching request type fields from:', url)

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
        serviceDeskId,
        requestTypeId,
        canAddRequestParticipants: data.canAddRequestParticipants ?? false,
        canRaiseOnBehalfOf: data.canRaiseOnBehalfOf ?? false,
        requestTypeFields: (data.requestTypeFields ?? []).map((field: Record<string, unknown>) => ({
          fieldId: field.fieldId ?? null,
          name: field.name ?? null,
          description: field.description ?? null,
          required: field.required ?? false,
          visible: field.visible ?? true,
          validValues: field.validValues ?? [],
          presetValues: field.presetValues ?? [],
          defaultValues: field.defaultValues ?? [],
          jiraSchema: field.jiraSchema ?? null,
        })),
      },
    })
  } catch (error) {
    logger.error('Error fetching request type fields:', {
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
