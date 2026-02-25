import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

const logger = createLogger('ConfluenceSpacePropertiesAPI')

export const dynamic = 'force-dynamic'

/**
 * List, create, or delete space properties.
 * Uses GET/POST /wiki/api/v2/spaces/{id}/properties
 * and DELETE /wiki/api/v2/spaces/{id}/properties/{propertyId}
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      domain,
      accessToken,
      spaceId,
      cloudId: providedCloudId,
      action,
      key,
      value,
      propertyId,
      limit = 50,
      cursor,
    } = body

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!spaceId) {
      return NextResponse.json({ error: 'Space ID is required' }, { status: 400 })
    }

    const spaceIdValidation = validateAlphanumericId(spaceId, 'spaceId', 255)
    if (!spaceIdValidation.isValid) {
      return NextResponse.json({ error: spaceIdValidation.error }, { status: 400 })
    }

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const baseUrl = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/spaces/${spaceId}/properties`

    // Validate required params for specific actions
    if (action === 'delete' && !propertyId) {
      return NextResponse.json(
        { error: 'Property ID is required for delete action' },
        { status: 400 }
      )
    }

    if (action === 'create' && !key) {
      return NextResponse.json(
        { error: 'Property key is required for create action' },
        { status: 400 }
      )
    }

    // Delete a property
    if (action === 'delete' && propertyId) {
      const propertyIdValidation = validateAlphanumericId(propertyId, 'propertyId', 255)
      if (!propertyIdValidation.isValid) {
        return NextResponse.json({ error: propertyIdValidation.error }, { status: 400 })
      }

      const url = `${baseUrl}/${propertyId}`

      logger.info(`Deleting space property ${propertyId} from space ${spaceId}`)

      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        logger.error('Confluence API error response:', {
          status: response.status,
          statusText: response.statusText,
          error: JSON.stringify(errorData, null, 2),
        })
        const errorMessage =
          errorData?.message || `Failed to delete space property (${response.status})`
        return NextResponse.json({ error: errorMessage }, { status: response.status })
      }

      return NextResponse.json({ spaceId, propertyId, deleted: true })
    }

    // Create a property
    if (action === 'create' && key) {
      logger.info(`Creating space property '${key}' on space ${spaceId}`)

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ key, value: value ?? {} }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        logger.error('Confluence API error response:', {
          status: response.status,
          statusText: response.statusText,
          error: JSON.stringify(errorData, null, 2),
        })
        const errorMessage =
          errorData?.message || `Failed to create space property (${response.status})`
        return NextResponse.json({ error: errorMessage }, { status: response.status })
      }

      const data = await response.json()
      return NextResponse.json({
        propertyId: data.id,
        key: data.key,
        value: data.value ?? null,
        spaceId,
      })
    }

    // List properties
    const queryParams = new URLSearchParams()
    queryParams.append('limit', String(Math.min(limit, 250)))

    if (cursor) queryParams.append('cursor', cursor)

    const url = `${baseUrl}?${queryParams.toString()}`

    logger.info(`Fetching properties for space ${spaceId}`)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: JSON.stringify(errorData, null, 2),
      })
      const errorMessage =
        errorData?.message || `Failed to list space properties (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()

    const properties = (data.results || []).map((prop: any) => ({
      id: prop.id,
      key: prop.key,
      value: prop.value ?? null,
    }))

    return NextResponse.json({
      properties,
      spaceId,
      nextCursor: data._links?.next
        ? new URL(data._links.next, 'https://placeholder').searchParams.get('cursor')
        : null,
    })
  } catch (error) {
    logger.error('Error with space properties:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
