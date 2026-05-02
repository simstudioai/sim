import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  confluenceDeletePageContract,
  confluencePageSelectorContract,
  confluenceUpdatePageContract,
} from '@/lib/api/contracts/selectors/confluence'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateJiraCloudId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getConfluenceCloudId } from '@/tools/confluence/utils'
import { parseAtlassianErrorMessage } from '@/tools/jira/utils'

const logger = createLogger('ConfluencePageAPI')

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(confluencePageSelectorContract, request, {})
    if (!parsed.success) return parsed.response

    const { domain, accessToken, cloudId: providedCloudId, pageId } = parsed.data.body

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}?body-format=storage`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })
      return NextResponse.json(
        { error: parseAtlassianErrorMessage(response.status, response.statusText, errorText) },
        { status: response.status }
      )
    }

    const data = await response.json()

    return NextResponse.json({
      id: data.id,
      title: data.title,
      body: {
        storage: {
          value: data.body?.storage?.value ?? null,
          representation: 'storage',
        },
      },
      status: data.status ?? null,
      spaceId: data.spaceId ?? null,
      parentId: data.parentId ?? null,
      authorId: data.authorId ?? null,
      createdAt: data.createdAt ?? null,
      version: data.version ?? null,
      _links: data._links ?? null,
    })
  } catch (error) {
    logger.error('Error fetching Confluence page:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})

export const PUT = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(confluenceUpdatePageContract, request, {})
    if (!parsed.success) return parsed.response

    const {
      domain,
      accessToken,
      pageId,
      cloudId: providedCloudId,
      title,
      body: pageBody,
      version,
    } = parsed.data.body

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const currentPageUrl = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}?body-format=storage`
    const currentPageResponse = await fetch(currentPageUrl, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!currentPageResponse.ok) {
      const errorText = await currentPageResponse.text()
      throw new Error(
        parseAtlassianErrorMessage(
          currentPageResponse.status,
          currentPageResponse.statusText,
          errorText
        )
      )
    }

    const currentPage = await currentPageResponse.json()
    const currentVersion = currentPage.version.number

    const updateBody: any = {
      id: pageId,
      version: {
        number: currentVersion + 1,
        message: version?.message || 'Updated via API',
      },
      status: 'current',
    }

    if (title !== undefined && title !== null && title !== '') {
      updateBody.title = title
    } else {
      updateBody.title = currentPage.title
    }

    if (pageBody?.value !== undefined && pageBody?.value !== null && pageBody?.value !== '') {
      updateBody.body = {
        representation: 'storage',
        value: pageBody.value,
      }
    } else {
      updateBody.body = {
        representation: 'storage',
        value: currentPage.body?.storage?.value || '',
      }
    }

    const response = await fetch(currentPageUrl, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(updateBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })
      return NextResponse.json(
        { error: parseAtlassianErrorMessage(response.status, response.statusText, errorText) },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    logger.error('Error updating Confluence page:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})

export const DELETE = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(confluenceDeletePageContract, request, {})
    if (!parsed.success) return parsed.response

    const { domain, accessToken, cloudId: providedCloudId, pageId, purge } = parsed.data.body

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const queryParams = new URLSearchParams()
    if (purge) {
      queryParams.append('purge', 'true')
    }
    const queryString = queryParams.toString()
    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}${queryString ? `?${queryString}` : ''}`

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })
      return NextResponse.json(
        { error: parseAtlassianErrorMessage(response.status, response.statusText, errorText) },
        { status: response.status }
      )
    }

    return NextResponse.json({ pageId, deleted: true })
  } catch (error) {
    logger.error('Error deleting Confluence page:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})
