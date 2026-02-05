import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

const logger = createLogger('ConfluencePagePropertiesAPI')

export const dynamic = 'force-dynamic'

const createPropertySchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
  cloudId: z.string().optional(),
  pageId: z.string().min(1, 'Page ID is required'),
  key: z.string().min(1, 'Property key is required'),
  value: z.any(),
})

const updatePropertySchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
  cloudId: z.string().optional(),
  pageId: z.string().min(1, 'Page ID is required'),
  propertyId: z.string().min(1, 'Property ID is required'),
  key: z.string().min(1, 'Property key is required'),
  value: z.any(),
  versionNumber: z.number().min(1, 'Version number is required'),
})

const deletePropertySchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
  cloudId: z.string().optional(),
  pageId: z.string().min(1, 'Page ID is required'),
  propertyId: z.string().min(1, 'Property ID is required'),
})

/**
 * List all content properties on a page.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const domain = searchParams.get('domain')
    const accessToken = searchParams.get('accessToken')
    const pageId = searchParams.get('pageId')
    const providedCloudId = searchParams.get('cloudId')
    const limit = searchParams.get('limit') || '50'
    const cursor = searchParams.get('cursor')

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!pageId) {
      return NextResponse.json({ error: 'Page ID is required' }, { status: 400 })
    }

    const pageIdValidation = validateAlphanumericId(pageId, 'pageId', 255)
    if (!pageIdValidation.isValid) {
      return NextResponse.json({ error: pageIdValidation.error }, { status: 400 })
    }

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const queryParams = new URLSearchParams()
    queryParams.append('limit', String(Math.min(Number(limit), 250)))
    if (cursor) {
      queryParams.append('cursor', cursor)
    }
    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}/properties?${queryParams.toString()}`

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
        errorData?.message || `Failed to list page properties (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()

    const properties = (data.results || []).map((prop: any) => ({
      id: prop.id,
      key: prop.key,
      value: prop.value ?? null,
      version: prop.version ?? null,
    }))

    return NextResponse.json({
      properties,
      pageId,
      nextCursor: data._links?.next
        ? new URL(data._links.next, 'https://placeholder').searchParams.get('cursor')
        : null,
    })
  } catch (error) {
    logger.error('Error listing page properties:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Create a new content property on a page.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    const validation = createPropertySchema.safeParse(body)
    if (!validation.success) {
      const firstError = validation.error.errors[0]
      return NextResponse.json({ error: firstError.message }, { status: 400 })
    }

    const { domain, accessToken, cloudId: providedCloudId, pageId, key, value } = validation.data

    const pageIdValidation = validateAlphanumericId(pageId, 'pageId', 255)
    if (!pageIdValidation.isValid) {
      return NextResponse.json({ error: pageIdValidation.error }, { status: 400 })
    }

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}/properties`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ key, value }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: JSON.stringify(errorData, null, 2),
      })
      const errorMessage =
        errorData?.message || `Failed to create page property (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json({
      id: data.id,
      key: data.key,
      value: data.value,
      version: data.version,
      pageId,
    })
  } catch (error) {
    logger.error('Error creating page property:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Update a content property on a page.
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    const validation = updatePropertySchema.safeParse(body)
    if (!validation.success) {
      const firstError = validation.error.errors[0]
      return NextResponse.json({ error: firstError.message }, { status: 400 })
    }

    const {
      domain,
      accessToken,
      cloudId: providedCloudId,
      pageId,
      propertyId,
      key,
      value,
      versionNumber,
    } = validation.data

    const pageIdValidation = validateAlphanumericId(pageId, 'pageId', 255)
    if (!pageIdValidation.isValid) {
      return NextResponse.json({ error: pageIdValidation.error }, { status: 400 })
    }

    const propertyIdValidation = validateAlphanumericId(propertyId, 'propertyId', 255)
    if (!propertyIdValidation.isValid) {
      return NextResponse.json({ error: propertyIdValidation.error }, { status: 400 })
    }

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}/properties/${propertyId}`

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        key,
        value,
        version: { number: versionNumber },
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: JSON.stringify(errorData, null, 2),
      })
      const errorMessage =
        errorData?.message || `Failed to update page property (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json({
      id: data.id,
      key: data.key,
      value: data.value,
      version: data.version,
      pageId,
    })
  } catch (error) {
    logger.error('Error updating page property:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Delete a content property from a page.
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    const validation = deletePropertySchema.safeParse(body)
    if (!validation.success) {
      const firstError = validation.error.errors[0]
      return NextResponse.json({ error: firstError.message }, { status: 400 })
    }

    const { domain, accessToken, cloudId: providedCloudId, pageId, propertyId } = validation.data

    const pageIdValidation = validateAlphanumericId(pageId, 'pageId', 255)
    if (!pageIdValidation.isValid) {
      return NextResponse.json({ error: pageIdValidation.error }, { status: 400 })
    }

    const propertyIdValidation = validateAlphanumericId(propertyId, 'propertyId', 255)
    if (!propertyIdValidation.isValid) {
      return NextResponse.json({ error: propertyIdValidation.error }, { status: 400 })
    }

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}/properties/${propertyId}`

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
        errorData?.message || `Failed to delete page property (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    return NextResponse.json({ propertyId, pageId, deleted: true })
  } catch (error) {
    logger.error('Error deleting page property:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
