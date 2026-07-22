import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import type { PiSandboxRunner } from '@/lib/execution/e2b'
import { REVIEW_TOOLS_SCRIPT } from '@/executor/handlers/pi/cloud-review-tools-script'
import { raceAbort } from '@/executor/handlers/pi/cloud-shared'
import type { PiSdk } from '@/executor/handlers/pi/pi-sdk'
import { scrubPiSecrets } from '@/executor/handlers/pi/redaction'
import {
  parseReviewFindings,
  type ReviewFindings,
  reviewFindingsSchema,
} from '@/tools/github/review-schema'

const REVIEW_TOOLS_SCRIPT_PATH = '/workspace/sim-review-tools.py'
const REVIEW_TOOLS_COMMAND = `python3 ${REVIEW_TOOLS_SCRIPT_PATH}`
const REVIEW_TOOL_TIMEOUT_MS = 30_000
const MAX_TOOL_CALLS = 200
const MAX_TOOL_OUTPUT_BYTES = 5_000_000

const REVIEW_TOOL_NAMES = {
  read: 'read_repo_file',
  search: 'search_repo',
  find: 'find_repo_files',
  list: 'list_repo_directory',
  changed: 'list_changed_files',
  diff: 'read_file_diff',
  submit: 'submit_review',
} as const

export const CLOUD_REVIEW_TOOL_NAMES = Object.values(REVIEW_TOOL_NAMES)

interface CloudReviewTools {
  tools: ToolDefinition[]
  getFindings: () => ReviewFindings | undefined
}

interface ReviewCommentCoordinate {
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  start_line?: number
  start_side?: 'LEFT' | 'RIGHT'
}

interface ReviewOperationArgs {
  read: { path: string; offset?: number; limit?: number }
  search: {
    pattern: string
    path?: string
    glob?: string
    ignore_case?: boolean
    literal?: boolean
    limit?: number
  }
  find: { pattern?: string; path?: string; limit?: number }
  list: { path?: string; limit?: number }
  list_changed_files: { base_sha: string; head_sha: string; offset?: number; limit?: number }
  read_file_diff: {
    base_sha: string
    head_sha: string
    path: string
    offset?: number
    limit?: number
  }
  validate_comments: {
    base_sha: string
    head_sha: string
    comments: ReviewCommentCoordinate[]
  }
  preflight_checkout: { head_sha: string }
}

type ReviewOperation = keyof ReviewOperationArgs

/** Installs the fixed sandbox helper used by every bounded read-only review tool. */
export async function installCloudReviewTools(runner: PiSandboxRunner): Promise<void> {
  await runner.writeFile(REVIEW_TOOLS_SCRIPT_PATH, REVIEW_TOOLS_SCRIPT)
}

/** Rejects repository trees that would exceed the review sandbox checkout budget. */
export async function preflightCloudReviewCheckout(
  runner: PiSandboxRunner,
  headSha: string,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) throw new Error('Pi cloud review aborted before checkout')
  const operation: ReviewOperation = 'preflight_checkout'
  const args: ReviewOperationArgs[typeof operation] = { head_sha: headSha }
  const result = await raceAbort(
    runner.run(REVIEW_TOOLS_COMMAND, {
      envs: {
        REVIEW_TOOL_OPERATION: operation,
        REVIEW_TOOL_ARGS: JSON.stringify(args),
      },
      timeoutMs: REVIEW_TOOL_TIMEOUT_MS,
    }),
    signal
  )
  if (signal?.aborted) throw new Error('Pi cloud review aborted before checkout')
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || 'Repository checkout preflight failed')
  }
}

/** Builds the only tools available to the host-side Pi review session. */
export function createCloudReviewTools(
  sdk: PiSdk,
  runner: PiSandboxRunner,
  baseSha: string,
  headSha: string,
  secrets: readonly string[] = []
): CloudReviewTools {
  let findings: ReviewFindings | undefined
  let toolCalls = 0
  let outputBytes = 0

  const runOperation = async <Operation extends ReviewOperation>(
    operation: Operation,
    args: ReviewOperationArgs[Operation],
    signal?: AbortSignal
  ): Promise<string> => {
    if (signal?.aborted) throw new Error('Review tool operation aborted')
    toolCalls += 1
    if (toolCalls > MAX_TOOL_CALLS) {
      throw new Error(`Review tool call limit exceeded (${MAX_TOOL_CALLS})`)
    }

    const result = await raceAbort(
      runner.run(REVIEW_TOOLS_COMMAND, {
        envs: {
          REVIEW_TOOL_OPERATION: operation,
          REVIEW_TOOL_ARGS: JSON.stringify(args),
        },
        timeoutMs: REVIEW_TOOL_TIMEOUT_MS,
      }),
      signal
    )
    if (signal?.aborted) throw new Error('Review tool operation aborted')
    if (result.exitCode !== 0) {
      throw new Error(
        scrubPiSecrets(
          result.stderr.trim() || `${operation} failed inside the review sandbox`,
          secrets
        )
      )
    }

    outputBytes += Buffer.byteLength(result.stdout)
    if (outputBytes > MAX_TOOL_OUTPUT_BYTES) {
      throw new Error(`Review tool output limit exceeded (${MAX_TOOL_OUTPUT_BYTES} bytes)`)
    }
    return scrubPiSecrets(result.stdout, secrets)
  }

  const readParameters = Type.Object(
    {
      path: Type.String({ minLength: 1, maxLength: 4_096 }),
      offset: Type.Optional(Type.Integer({ minimum: 1 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_000 })),
    },
    { additionalProperties: false }
  )
  const searchParameters = Type.Object(
    {
      pattern: Type.String({ minLength: 1, maxLength: 1_000 }),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
      glob: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
      ignore_case: Type.Optional(Type.Boolean()),
      literal: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    },
    { additionalProperties: false }
  )
  const findParameters = Type.Object(
    {
      pattern: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000 })),
    },
    { additionalProperties: false }
  )
  const listParameters = Type.Object(
    {
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    },
    { additionalProperties: false }
  )
  const changedFilesParameters = Type.Object(
    {
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    },
    { additionalProperties: false }
  )
  const fileDiffParameters = Type.Object(
    {
      path: Type.String({ minLength: 1, maxLength: 4_096 }),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    },
    { additionalProperties: false }
  )

  const tools = [
    sdk.defineTool({
      name: REVIEW_TOOL_NAMES.read,
      label: 'Read repository file',
      description: 'Read a bounded range of a repository file with line numbers.',
      parameters: readParameters,
      executionMode: 'sequential',
      execute: async (_toolCallId, args, signal) => ({
        content: [{ type: 'text', text: await runOperation('read', args, signal) }],
        details: undefined,
      }),
    }),
    sdk.defineTool({
      name: REVIEW_TOOL_NAMES.search,
      label: 'Search repository',
      description: 'Search repository file contents with a bounded ripgrep query.',
      parameters: searchParameters,
      executionMode: 'sequential',
      execute: async (_toolCallId, args, signal) => ({
        content: [{ type: 'text', text: await runOperation('search', args, signal) }],
        details: undefined,
      }),
    }),
    sdk.defineTool({
      name: REVIEW_TOOL_NAMES.find,
      label: 'Find repository files',
      description: 'List bounded repository file paths, optionally filtered by a glob.',
      parameters: findParameters,
      executionMode: 'sequential',
      execute: async (_toolCallId, args, signal) => ({
        content: [{ type: 'text', text: await runOperation('find', args, signal) }],
        details: undefined,
      }),
    }),
    sdk.defineTool({
      name: REVIEW_TOOL_NAMES.list,
      label: 'List repository directory',
      description: 'List a bounded number of entries in a repository directory.',
      parameters: listParameters,
      executionMode: 'sequential',
      execute: async (_toolCallId, args, signal) => ({
        content: [{ type: 'text', text: await runOperation('list', args, signal) }],
        details: undefined,
      }),
    }),
    sdk.defineTool({
      name: REVIEW_TOOL_NAMES.changed,
      label: 'List changed files',
      description:
        'List exact changed filenames from the pinned diff. Follow next_offset until it is null.',
      parameters: changedFilesParameters,
      executionMode: 'sequential',
      execute: async (_toolCallId, args, signal) => ({
        content: [
          {
            type: 'text',
            text: await runOperation(
              'list_changed_files',
              { ...args, base_sha: baseSha, head_sha: headSha },
              signal
            ),
          },
        ],
        details: undefined,
      }),
    }),
    sdk.defineTool({
      name: REVIEW_TOOL_NAMES.diff,
      label: 'Read file diff',
      description:
        'Read a page of the pinned diff for one exact changed filename. Follow next_offset until it is null.',
      parameters: fileDiffParameters,
      executionMode: 'sequential',
      execute: async (_toolCallId, args, signal) => ({
        content: [
          {
            type: 'text',
            text: await runOperation(
              'read_file_diff',
              { ...args, base_sha: baseSha, head_sha: headSha },
              signal
            ),
          },
        ],
        details: undefined,
      }),
    }),
    sdk.defineTool({
      name: REVIEW_TOOL_NAMES.submit,
      label: 'Submit review findings',
      description:
        'Finish the review with one markdown summary and optional inline comments on exact diff lines.',
      parameters: reviewFindingsSchema,
      executionMode: 'sequential',
      execute: async (_toolCallId, args, signal) => {
        if (findings) throw new Error('Review findings were already submitted')
        const parsed = parseReviewFindings(args)
        const coordinates = parsed.comments.map(({ body: _body, ...coordinate }) => coordinate)
        await runOperation(
          'validate_comments',
          { base_sha: baseSha, head_sha: headSha, comments: coordinates },
          signal
        )
        findings = parsed
        return {
          content: [{ type: 'text', text: 'Review findings captured.' }],
          details: undefined,
          terminate: true,
        }
      },
    }),
  ]

  return {
    tools,
    getFindings: () => findings,
  }
}
