import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { SEARCH_TOOL_COST } from '@/lib/billing/constants'
import { env } from '@/lib/core/config/env'
import { executeTool } from '@/tools'

const logger = createLogger('search')

const SearchRequestSchema = z.object({
  query: z.string().min(1),
})

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    const { searchParams: urlParams } = new URL(request.url)
    const workflowId = urlParams.get('workflowId') || undefined

    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      const errorMessage = workflowId ? 'Workflow not found' : authResult.error || 'Unauthorized'
      const statusCode = workflowId ? 404 : 401
      return NextResponse.json({ success: false, error: errorMessage }, { status: statusCode })
    }

    const userId = authResult.userId

    logger.info(`[${requestId}] Authenticated search request via ${authResult.authType}`, {
      userId,
    })

    const body = await request.json()
    const validated = SearchRequestSchema.parse(body)

    const exaApiKey = env.EXA_API_KEY

    if (!exaApiKey) {
      logger.error(`[${requestId}] No Exa API key available`)
      return NextResponse.json(
        { success: false, error: 'Search service not configured' },
        { status: 503 }
      )
    }

    logger.info(`[${requestId}] Executing search`, {
      userId,
      query: validated.query,
    })

    const result = await executeTool('exa_search', {
      query: validated.query,
      type: 'auto',
      useAutoprompt: true,
      highlights: true,
      apiKey: exaApiKey,
    })

    if (!result.success) {
      logger.error(`[${requestId}] Search failed`, {
        userId,
        error: result.error,
      })
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Search failed',
        },
        { status: 500 }
      )
    }

    const results = (result.output.results || []).map((r: any, index: number) => ({
      title: r.title || '',
      link: r.url || '',
      snippet: Array.isArray(r.highlights) ? r.highlights.join(' ... ') : '',
      date: r.publishedDate || undefined,
      position: index + 1,
    }))

    const cost = {
      input: 0,
      output: 0,
      total: SEARCH_TOOL_COST,
      tokens: {
        input: 0,
        output: 0,
        total: 0,
      },
      model: 'search-exa',
      pricing: {
        input: 0,
        cachedInput: 0,
        output: 0,
        updatedAt: new Date().toISOString(),
      },
    }

    logger.info(`[${requestId}] Search completed`, {
      userId,
      resultCount: results.length,
      cost: cost.total,
    })

    return NextResponse.json({
      results,
      query: validated.query,
      totalResults: results.length,
      source: 'exa',
      cost,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Search failed`, {
      error: error.message,
      stack: error.stack,
    })

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Search failed',
      },
      { status: 500 }
    )
  }
}
