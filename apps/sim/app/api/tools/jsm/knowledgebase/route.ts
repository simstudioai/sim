import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { getJiraCloudId, getJsmApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JsmKnowledgeBaseAPI')

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
      highlight,
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

    if (!query) {
      logger.error('Missing query in request')
      return NextResponse.json({ error: 'Search query is required' }, { status: 400 })
    }

    if (serviceDeskId) {
      const serviceDeskIdValidation = validateAlphanumericId(serviceDeskId, 'serviceDeskId')
      if (!serviceDeskIdValidation.isValid) {
        return NextResponse.json({ error: serviceDeskIdValidation.error }, { status: 400 })
      }
    }

    const cloudId = cloudIdParam || (await getJiraCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const baseUrl = getJsmApiBaseUrl(cloudId)
    const params = new URLSearchParams()
    params.append('query', query)
    if (highlight !== undefined) params.append('highlight', String(highlight))
    if (start) params.append('start', start)
    if (limit) params.append('limit', limit)

    const basePath = serviceDeskId
      ? `${baseUrl}/servicedesk/${serviceDeskId}/knowledgebase/article`
      : `${baseUrl}/knowledgebase/article`

    const url = `${basePath}?${params.toString()}`

    logger.info('Searching knowledge base:', url)

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

    const articles = (data.values || []).map((article: Record<string, unknown>) => ({
      title: (article.title as string) ?? '',
      excerpt: (article.excerpt as string) ?? '',
      sourceType: (article.source as Record<string, unknown>)?.type ?? '',
      sourcePageId: (article.source as Record<string, unknown>)?.pageId ?? null,
      sourceSpaceKey: (article.source as Record<string, unknown>)?.spaceKey ?? null,
      contentUrl: (article.content as Record<string, unknown>)?.iframeSrc ?? null,
    }))

    return NextResponse.json({
      success: true,
      output: {
        ts: new Date().toISOString(),
        articles,
        total: data.size || 0,
        isLastPage: data.isLastPage ?? true,
      },
    })
  } catch (error) {
    logger.error('Error searching knowledge base:', {
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
