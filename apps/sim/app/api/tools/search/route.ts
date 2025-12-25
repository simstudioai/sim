import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getBYOKKey } from '@/lib/api-key/byok'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { SEARCH_TOOL_COST } from '@/lib/billing/constants'
import { env } from '@/lib/core/config/env'
import { createLogger } from '@/lib/logs/console/logger'
import { executeTool } from '@/tools'

const logger = createLogger('search')

const SearchRequestSchema = z.object({
  query: z.string().min(1),
  workspaceId: z.string().optional(),
})

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    const { searchParams: urlParams } = new URL(request.url)
    const workflowId = urlParams.get('workflowId') || undefined

    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

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

    let exaApiKey = env.EXA_API_KEY
    let isBYOK = false

    if (validated.workspaceId) {
      const byokResult = await getBYOKKey(validated.workspaceId, 'exa')
      if (byokResult) {
        exaApiKey = byokResult.apiKey
        isBYOK = true
        logger.info(`[${requestId}] Using workspace BYOK key for Exa search`)
      }
    }

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
      isBYOK,
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
      total: isBYOK ? 0 : SEARCH_TOOL_COST,
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
      isBYOK,
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
