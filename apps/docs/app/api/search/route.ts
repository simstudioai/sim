import { createLogger } from '@sim/logger'
import { searchDocs } from '@/lib/search/service'

const logger = createLogger('DocsSearchAPI')
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const query = params.get('query') || params.get('q') || ''
  const requestedLimit = Number.parseInt(params.get('limit') ?? '10', 10)
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 10
  try {
    return Response.json(await searchDocs(query, limit, request.signal), {
      headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60' },
    })
  } catch (error) {
    logger.error('Documentation search failed', { error })
    return Response.json({ error: 'Search is unavailable. Try again.' }, { status: 503 })
  }
}
