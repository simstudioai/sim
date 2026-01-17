import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'

const logger = createLogger('BrightDataScrapeMarkdownAPI')

export async function POST(request: Request) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const url = typeof body?.url === 'string' ? body.url : undefined
    const apiToken = typeof body?.apiToken === 'string' ? body.apiToken : undefined
    const unlockerZone = typeof body?.unlockerZone === 'string' ? body.unlockerZone : undefined

    if (!url || !apiToken) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }

    logger.info(`[${requestId}] Scraping URL as markdown`, { url })

    const response = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        zone: unlockerZone || 'mcp_unlocker',
        url,
        format: 'raw',
        data_format: 'markdown',
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

      logger.error(`[${requestId}] Scraping failed`, {
        url,
        status: response.status,
        error: errorMessage,
      })

      return NextResponse.json(
        { error: errorMessage || 'Scraping failed' },
        { status: response.status }
      )
    }

    const markdown =
      typeof payload === 'object' && payload !== null && 'markdown' in payload
        ? String((payload as { markdown?: unknown }).markdown ?? '')
        : typeof payload === 'string'
          ? payload
          : JSON.stringify(payload)

    const title =
      typeof payload === 'object' && payload !== null && 'title' in payload
        ? String((payload as { title?: unknown }).title ?? '')
        : undefined

    logger.info(`[${requestId}] Scraping completed`, { url })

    return NextResponse.json({
      markdown,
      url,
      title: title || undefined,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scraping failed'
    logger.error(`[${requestId}] Scraping failed`, { error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
