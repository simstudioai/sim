/**
 * Cloud Code Review backend: runs the Pi CLI inside an E2B sandbox against a
 * checked-out PR head, then posts a structured GitHub review (summary + optional
 * inline comments). Secrets are isolated per command: the GitHub token is present
 * only for the clone/fetch step, while the Pi loop runs with a BYOK model key
 * only. Review posting happens on the host via executeTool (never inside the
 * sandbox). The agent is read-only — no commit/push.
 */

import { createLogger } from '@sim/logger'
import { truncate } from '@sim/utils/string'
import { withPiSandbox } from '@/lib/execution/e2b'
import type { PiBackendRun, PiCloudReviewRunParams } from '@/executor/handlers/pi/backend'
import {
  CLONE_TIMEOUT_MS,
  extractMarkerValues,
  PI_SCRIPT,
  PI_TIMEOUT_MS,
  PROMPT_PATH,
  REPO_DIR,
  raceAbort,
  scrubGitSecrets,
} from '@/executor/handlers/pi/cloud-shared'
import { buildPiPrompt } from '@/executor/handlers/pi/context'
import { applyPiEvent, createPiTotals, parseJsonLine } from '@/executor/handlers/pi/events'
import { mapThinkingLevel, providerApiKeyEnvVar } from '@/executor/handlers/pi/keys'
import { executeTool } from '@/tools'
import type { CreatePRReviewComment } from '@/tools/github/types'

const logger = createLogger('PiCloudReviewBackend')

const REVIEW_PATH = '/workspace/pi-review.json'
const PR_CONTEXT_PATH = '/workspace/pi-pr-context.md'
const MAX_CONTEXT_BYTES = 400_000
const REVIEW_BODY_MAX = 65_000

const REVIEW_GUIDANCE =
  'You are reviewing an existing pull request inside an automated sandbox. ' +
  'Explore the checked-out PR branch and the PR context file at /workspace/pi-pr-context.md. ' +
  'Do not edit files, do not run git commands that modify state (commit, push, branch, remote), ' +
  'do not configure git credentials, and do not call GitHub APIs — after you finish, Sim posts ' +
  'the review for you. When done, write your findings to /workspace/pi-review.json as JSON with ' +
  'this exact shape: {"body":"<markdown summary>","comments":[{"path":"<file>","body":"<comment>",' +
  '"line":<number>,"side":"RIGHT"}]}. The body is required. comments is optional; omit it or use ' +
  '[] when you have no inline comments. Prefer RIGHT-side line numbers from the PR diff. Keep ' +
  'comments specific and actionable.'

const CLONE_PR_SCRIPT = `set -e
rm -rf ${REPO_DIR}
git clone --no-checkout "https://x-access-token:$GITHUB_TOKEN@github.com/$REPO_OWNER/$REPO_NAME.git" ${REPO_DIR}
cd ${REPO_DIR}
git fetch origin "pull/$PULL_NUMBER/head:pr-$PULL_NUMBER"
git checkout "pr-$PULL_NUMBER"
git rev-parse HEAD | sed "s/^/__HEAD_SHA__=/"
git remote set-url origin "https://github.com/$REPO_OWNER/$REPO_NAME.git"`

interface PrContext {
  headSha: string
  title: string
  body: string
  htmlUrl: string
  files: Array<{
    filename?: string
    status?: string
    additions?: number
    deletions?: number
    changes?: number
    patch?: string
  }>
}

interface ParsedReviewFindings {
  body: string
  comments: CreatePRReviewComment[]
}

async function fetchPrContext(params: PiCloudReviewRunParams): Promise<PrContext> {
  const result = await executeTool('github_pr_v2', {
    owner: params.owner,
    repo: params.repo,
    pullNumber: params.pullNumber,
    apiKey: params.githubToken,
  })

  if (!result.success) {
    throw new Error(`Failed to fetch PR #${params.pullNumber}: ${result.error ?? 'unknown error'}`)
  }

  const output = result.output as {
    title?: string
    body?: string | null
    html_url?: string
    head?: { sha?: string }
    files?: PrContext['files']
  }

  const headSha = output.head?.sha?.trim()
  if (!headSha) {
    throw new Error(`PR #${params.pullNumber} did not include a head commit SHA`)
  }

  return {
    headSha,
    title: output.title?.trim() || `PR #${params.pullNumber}`,
    body: typeof output.body === 'string' ? output.body : '',
    htmlUrl: output.html_url ?? '',
    files: Array.isArray(output.files) ? output.files : [],
  }
}

function buildPrContextMarkdown(params: PiCloudReviewRunParams, pr: PrContext): string {
  const fileSections = pr.files.map((file) => {
    const name = file.filename || 'unknown'
    const stats = `status=${file.status ?? 'unknown'} +${file.additions ?? 0}/-${file.deletions ?? 0}`
    const patch = file.patch?.trim()
      ? `\n\`\`\`diff\n${truncate(file.patch, 20_000)}\n\`\`\``
      : '\n_(patch omitted)_'
    return `### ${name}\n${stats}${patch}`
  })

  const content = [
    `# Pull request #${params.pullNumber}`,
    '',
    `Title: ${pr.title}`,
    pr.htmlUrl ? `URL: ${pr.htmlUrl}` : '',
    `Head SHA: ${pr.headSha}`,
    '',
    '## Description',
    '',
    pr.body.trim() || '_No description_',
    '',
    '## Changed files',
    '',
    fileSections.length > 0 ? fileSections.join('\n\n') : '_No files returned_',
  ]
    .filter((line) => line !== '')
    .join('\n')

  return content.length > MAX_CONTEXT_BYTES
    ? `${content.slice(0, MAX_CONTEXT_BYTES)}\n\n[context truncated]`
    : content
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

/**
 * Parses agent review JSON. Invalid inline comments are skipped so a usable
 * summary body can still be submitted; comments without a valid line are dropped
 * because GitHub rejects line-less review comments when commit_id is set.
 */
function parseReviewFindings(raw: string): ParsedReviewFindings {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Pi review output was not valid JSON at /workspace/pi-review.json')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Pi review output must be a JSON object with a body field')
  }

  const record = parsed as Record<string, unknown>
  if (typeof record.body !== 'string' || !record.body.trim()) {
    throw new Error('Pi review output must include a non-empty body string')
  }

  const comments: CreatePRReviewComment[] = []
  // Treat null/undefined as "no comments" — agents often emit null for optional fields.
  if (record.comments != null) {
    if (!Array.isArray(record.comments)) {
      throw new Error('Pi review output comments must be an array when present')
    }
    for (const item of record.comments) {
      if (!item || typeof item !== 'object') continue
      const comment = item as Record<string, unknown>
      if (typeof comment.path !== 'string' || !comment.path.trim()) continue
      if (typeof comment.body !== 'string' || !comment.body.trim()) continue
      if (!isPositiveInt(comment.line)) continue

      const normalized: CreatePRReviewComment = {
        path: comment.path.trim(),
        body: comment.body,
        line: comment.line,
        side: comment.side === 'LEFT' || comment.side === 'RIGHT' ? comment.side : 'RIGHT',
      }
      if (
        isPositiveInt(comment.start_line) &&
        comment.start_line < comment.line &&
        (comment.start_side === undefined ||
          comment.start_side === 'LEFT' ||
          comment.start_side === 'RIGHT')
      ) {
        normalized.start_line = comment.start_line
        if (comment.start_side === 'LEFT' || comment.start_side === 'RIGHT') {
          normalized.start_side = comment.start_side
        }
      }
      comments.push(normalized)
    }
  }

  return {
    body: truncate(record.body.trim(), REVIEW_BODY_MAX),
    comments,
  }
}

async function submitReview(
  params: PiCloudReviewRunParams,
  headSha: string,
  findings: ParsedReviewFindings
): Promise<{ reviewUrl?: string; commentsPosted: number }> {
  const result = await executeTool('github_create_pr_review', {
    owner: params.owner,
    repo: params.repo,
    pullNumber: params.pullNumber,
    event: params.reviewEvent,
    body: findings.body,
    commit_id: headSha,
    comments: findings.comments,
    apiKey: params.githubToken,
  })

  if (!result.success) {
    throw new Error(
      `Failed to submit review for PR #${params.pullNumber}: ${result.error ?? 'unknown error'}`
    )
  }

  const output = result.output as { metadata?: { html_url?: string }; html_url?: string }
  const reviewUrl = output.metadata?.html_url ?? output.html_url
  return { reviewUrl, commentsPosted: findings.comments.length }
}

export const runCloudReviewPi: PiBackendRun<PiCloudReviewRunParams> = async (params, context) => {
  if (!params.isBYOK) {
    throw new Error(
      'Cloud mode requires your own provider API key (BYOK). Set one in Settings > BYOK.'
    )
  }
  const keyEnvVar = providerApiKeyEnvVar(params.providerId)
  if (!keyEnvVar) {
    throw new Error(
      `Provider "${params.providerId}" is not supported in cloud mode. Use a key-based provider or run in local mode.`
    )
  }

  const pr = await fetchPrContext(params)
  const prContextMarkdown = buildPrContextMarkdown(params, pr)
  const prompt = buildPiPrompt({
    skills: params.skills,
    initialMessages: params.initialMessages,
    task: params.task,
    guidance: REVIEW_GUIDANCE,
  })
  const totals = createPiTotals()
  const thinking = mapThinkingLevel(params.thinkingLevel) ?? 'medium'

  return withPiSandbox(async (runner) => {
    try {
      const clone = await raceAbort(
        runner.run(CLONE_PR_SCRIPT, {
          envs: {
            GITHUB_TOKEN: params.githubToken,
            REPO_OWNER: params.owner,
            REPO_NAME: params.repo,
            PULL_NUMBER: String(params.pullNumber),
          },
          timeoutMs: CLONE_TIMEOUT_MS,
        }),
        context.signal
      )
      if (clone.exitCode !== 0) {
        throw new Error(
          `git clone/fetch PR failed: ${scrubGitSecrets(clone.stderr || clone.stdout || 'unknown error', params.githubToken)}`
        )
      }
      const clonedHead = extractMarkerValues(clone.stdout, '__HEAD_SHA__=')[0]
      if (!clonedHead) {
        throw new Error('PR checkout did not report a head commit')
      }

      await runner.writeFile(PROMPT_PATH, prompt)
      await runner.writeFile(PR_CONTEXT_PATH, prContextMarkdown)

      let buffer = ''
      const handleChunk = (chunk: string) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const event = parseJsonLine(line)
          if (!event) continue
          applyPiEvent(totals, event)
          context.onEvent(event)
        }
      }
      const piRun = await raceAbort(
        runner.run(PI_SCRIPT, {
          envs: {
            [keyEnvVar]: params.apiKey,
            PI_PROVIDER: params.providerId,
            PI_MODEL: params.model,
            PI_THINKING: thinking,
          },
          timeoutMs: PI_TIMEOUT_MS,
          onStdout: handleChunk,
        }),
        context.signal
      )
      const remaining = buffer.trim() ? parseJsonLine(buffer) : null
      if (remaining) {
        applyPiEvent(totals, remaining)
        context.onEvent(remaining)
      }
      if (piRun.exitCode !== 0) {
        throw new Error(
          `Pi agent failed (exit ${piRun.exitCode}): ${piRun.stderr || piRun.stdout}`.trim()
        )
      }
      if (totals.errorMessage) {
        throw new Error(`Pi agent failed: ${totals.errorMessage}`)
      }

      let reviewRaw: string
      try {
        reviewRaw = await runner.readFile(REVIEW_PATH)
      } catch {
        throw new Error(
          'Pi agent did not write /workspace/pi-review.json — ensure the agent ends by writing the review JSON file'
        )
      }

      const findings = parseReviewFindings(reviewRaw)
      if (!totals.finalText.trim()) {
        totals.finalText = findings.body
      }

      // Submit against the SHA we actually checked out, not the earlier API fetch —
      // the PR head can move between fetchPrContext and clone.
      const { reviewUrl, commentsPosted } = await submitReview(params, clonedHead, findings)

      logger.info('Pi cloud review submitted', {
        owner: params.owner,
        repo: params.repo,
        pullNumber: params.pullNumber,
        commentsPosted,
      })

      return { totals, reviewUrl, commentsPosted }
    } catch (error) {
      if (context.signal?.aborted) {
        logger.info('Pi cloud review aborted', {
          owner: params.owner,
          repo: params.repo,
          pullNumber: params.pullNumber,
        })
      }
      throw error
    }
  })
}
