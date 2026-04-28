import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('SkillsImportAPI')

const FETCH_TIMEOUT_MS = 15_000

const ImportSchema = z.object({
  url: z.string().url('A valid URL is required'),
})

/**
 * Converts a standard GitHub file URL to its raw.githubusercontent.com equivalent.
 *
 * Supported formats:
 *   github.com/{owner}/{repo}/blob/{branch}/{path}
 *   raw.githubusercontent.com/{owner}/{repo}/{branch}/{path} (passthrough)
 */
function toRawGitHubUrl(url: string): string {
  const parsed = new URL(url)

  if (parsed.hostname === 'raw.githubusercontent.com') {
    return url
  }

  if (parsed.hostname !== 'github.com') {
    throw new Error('Only GitHub URLs are supported')
  }

  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length < 5 || segments[2] !== 'blob') {
    throw new Error(
      'Invalid GitHub URL format. Expected: https://github.com/{owner}/{repo}/blob/{branch}/{path}'
    )
  }

  const [owner, repo, , branch, ...pathParts] = segments
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pathParts.join('/')}`
}

/** POST - Fetch a SKILL.md from a GitHub URL and return its raw content */
export const POST = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized skill import attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { url } = ImportSchema.parse(body)

    let rawUrl: string
    try {
      rawUrl = toRawGitHubUrl(url)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid URL'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const response = await fetch(rawUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'text/plain' },
    })

    if (!response.ok) {
      logger.warn(`[${requestId}] GitHub fetch failed`, {
        status: response.status,
        url: rawUrl,
      })
      return NextResponse.json(
        { error: `Failed to fetch file (HTTP ${response.status}). Is the repository public?` },
        { status: 502 }
      )
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && Number.parseInt(contentLength, 10) > 100_000) {
      return NextResponse.json({ error: 'File is too large (max 100KB)' }, { status: 400 })
    }

    const content = await response.text()

    if (content.length > 100_000) {
      return NextResponse.json({ error: 'File is too large (max 100KB)' }, { status: 400 })
    }

    return NextResponse.json({ content })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', details: error.errors }, { status: 400 })
    }

    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      logger.warn(`[${requestId}] GitHub fetch timed out`)
      return NextResponse.json({ error: 'Request timed out' }, { status: 504 })
    }

    logger.error(`[${requestId}] Error importing skill`, error)
    return NextResponse.json({ error: 'Failed to import skill' }, { status: 500 })
  }
})
