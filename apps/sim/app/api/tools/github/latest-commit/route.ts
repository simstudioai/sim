import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'

export const dynamic = 'force-dynamic'

const logger = createLogger('GitHubLatestCommitAPI')

interface GitHubErrorResponse {
  message?: string
}

interface GitHubCommitResponse {
  sha: string
  html_url: string
  commit: {
    message: string
    author: { name: string; email: string; date: string }
    committer: { name: string; email: string; date: string }
  }
  author?: { login: string; avatar_url: string; html_url: string }
  committer?: { login: string; avatar_url: string; html_url: string }
  stats?: { additions: number; deletions: number; total: number }
  files?: Array<{
    filename: string
    status: string
    additions: number
    deletions: number
    changes: number
    patch?: string
    raw_url?: string
    blob_url?: string
  }>
}

const GitHubLatestCommitSchema = z.object({
  owner: z.string().min(1, 'Owner is required'),
  repo: z.string().min(1, 'Repo is required'),
  branch: z.string().optional().nullable(),
  apiKey: z.string().min(1, 'API key is required'),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized GitHub latest commit attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedData = GitHubLatestCommitSchema.parse(body)

    const { owner, repo, branch, apiKey } = validatedData

    const baseUrl = `https://api.github.com/repos/${owner}/${repo}`
    const commitUrl = branch ? `${baseUrl}/commits/${branch}` : `${baseUrl}/commits/HEAD`

    logger.info(`[${requestId}] Fetching latest commit from GitHub`, { owner, repo, branch })

    const urlValidation = await validateUrlWithDNS(commitUrl, 'commitUrl')
    if (!urlValidation.isValid) {
      return NextResponse.json({ success: false, error: urlValidation.error }, { status: 400 })
    }

    const response = await secureFetchWithPinnedIP(commitUrl, urlValidation.resolvedIP!, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github.v3+json',
        Authorization: `Bearer ${apiKey}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as GitHubErrorResponse
      logger.error(`[${requestId}] GitHub API error`, {
        status: response.status,
        error: errorData,
      })
      return NextResponse.json(
        { success: false, error: errorData.message || `GitHub API error: ${response.status}` },
        { status: 400 }
      )
    }

    const data = (await response.json()) as GitHubCommitResponse

    const content = `Latest commit: "${data.commit.message}" by ${data.commit.author.name} on ${data.commit.author.date}. SHA: ${data.sha}`

    const files = data.files || []
    const fileDetailsWithContent = []

    for (const file of files) {
      const fileDetail: Record<string, any> = {
        filename: file.filename,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        status: file.status,
        raw_url: file.raw_url,
        blob_url: file.blob_url,
        patch: file.patch,
        content: undefined,
      }

      if (file.status !== 'removed' && file.raw_url) {
        try {
          const rawUrlValidation = await validateUrlWithDNS(file.raw_url, 'rawUrl')
          if (rawUrlValidation.isValid) {
            const contentResponse = await secureFetchWithPinnedIP(
              file.raw_url,
              rawUrlValidation.resolvedIP!,
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  'X-GitHub-Api-Version': '2022-11-28',
                },
              }
            )

            if (contentResponse.ok) {
              fileDetail.content = await contentResponse.text()
            }
          }
        } catch (error) {
          logger.warn(`[${requestId}] Failed to fetch content for ${file.filename}:`, error)
        }
      }

      fileDetailsWithContent.push(fileDetail)
    }

    logger.info(`[${requestId}] Latest commit fetched successfully`, {
      sha: data.sha,
      fileCount: files.length,
    })

    return NextResponse.json({
      success: true,
      output: {
        content,
        metadata: {
          sha: data.sha,
          html_url: data.html_url,
          commit_message: data.commit.message,
          author: {
            name: data.commit.author.name,
            login: data.author?.login || 'Unknown',
            avatar_url: data.author?.avatar_url || '',
            html_url: data.author?.html_url || '',
          },
          committer: {
            name: data.commit.committer.name,
            login: data.committer?.login || 'Unknown',
            avatar_url: data.committer?.avatar_url || '',
            html_url: data.committer?.html_url || '',
          },
          stats: data.stats
            ? {
                additions: data.stats.additions,
                deletions: data.stats.deletions,
                total: data.stats.total,
              }
            : undefined,
          files: fileDetailsWithContent.length > 0 ? fileDetailsWithContent : undefined,
        },
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching GitHub latest commit:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
