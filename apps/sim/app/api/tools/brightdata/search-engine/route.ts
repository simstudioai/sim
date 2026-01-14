import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'

const logger = createLogger('BrightDataSearchEngineAPI')

export async function POST(request: Request) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const query = typeof body?.query === 'string' ? body.query : undefined
    const apiToken = typeof body?.apiToken === 'string' ? body.apiToken : undefined
    const unlockerZone = typeof body?.unlockerZone === 'string' ? body.unlockerZone : undefined
    const maxResults =
      typeof body?.maxResults === 'number'
        ? body.maxResults
        : typeof body?.maxResults === 'string'
          ? Number(body.maxResults)
          : undefined

    if (!query || !apiToken) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }

    logger.info(`[${requestId}] Searching`, { query, maxResults })

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&start=0&brd_json=1`

    const response = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        zone: unlockerZone || 'mcp_unlocker',
        url: searchUrl,
        format: 'raw',
        data_format: 'parsed_light',
      }),
    })

    const responseText = await response.text()
    let payload: unknown = responseText

    try {
      payload = JSON.parse(responseText)
    } catch {
      payload = responseText
    }

    if (!response.ok) {
      const errorMessage =
        typeof payload === 'object' && payload !== null && 'error' in payload
          ? String((payload as { error?: unknown }).error)
          : response.statusText

      logger.error(`[${requestId}] Search failed`, {
        query,
        status: response.status,
        error: errorMessage,
      })

      return NextResponse.json(
        { error: errorMessage || 'Search failed' },
        { status: response.status }
      )
    }

    let normalizedResults: Array<{ title: string; url: string; snippet: string }> = []

    if (typeof payload === 'object' && payload !== null) {
      const organic = (payload as { organic?: unknown }).organic
      if (Array.isArray(organic)) {
        normalizedResults = organic
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null
            const rawTitle = (entry as { title?: unknown }).title
            const rawLink = (entry as { link?: unknown }).link
            const rawDescription = (entry as { description?: unknown }).description
            const title = typeof rawTitle === 'string' ? rawTitle : ''
            const url = typeof rawLink === 'string' ? rawLink : ''
            const snippet = typeof rawDescription === 'string' ? rawDescription : ''
            if (!title || !url) return null
            return { title, url, snippet }
          })
          .filter(Boolean) as Array<{ title: string; url: string; snippet: string }>
      }
    }

    const maxCount = Number.isFinite(maxResults) ? Number(maxResults) : undefined
    const results = maxCount ? normalizedResults.slice(0, maxCount) : normalizedResults

    logger.info(`[${requestId}] Search completed`, { resultCount: results.length })

    return NextResponse.json({
      results,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Search failed'
    logger.error(`[${requestId}] Search failed`, { error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
