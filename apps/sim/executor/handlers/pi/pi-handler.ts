/**
 * Executor handler for the Pi Coding Agent block. Resolves the model key,
 * skills, and memory, selects a backend by `mode`, and runs it — streaming the
 * agent's text to the client when the block is selected for streaming output,
 * otherwise returning a plain block output. Create PR optionally composes the
 * internal Babysit continuation in its backend.
 */

import { createLogger } from '@sim/logger'
import type { BlockOutput } from '@/blocks/types'
import { parseOptionalNumberInput } from '@/blocks/utils'
import {
  assertPermissionsAllowed,
  ToolNotAllowedError,
} from '@/ee/access-control/utils/permission-check'
import { BlockType } from '@/executor/constants'
import type {
  PiBackendRun,
  PiCloudBranchRunParams,
  PiCloudReviewRunParams,
  PiCloudRunParams,
  PiLocalRunParams,
  PiRunParams,
  PiRunResult,
  PiSearchConfig,
} from '@/executor/handlers/pi/backend'
import { runCloudBranchPi, runCloudPi } from '@/executor/handlers/pi/cloud-backend'
import { runCloudReviewPi } from '@/executor/handlers/pi/cloud-review-backend'
import {
  appendPiMemory,
  loadPiMemory,
  type PiMemoryConfig,
  resolvePiSkills,
} from '@/executor/handlers/pi/context'
import { streamTextForEvent } from '@/executor/handlers/pi/events'
import {
  computePiCost,
  PI_SEARCH_PROVIDERS,
  parsePiSearchProvider,
  resolvePiModelKey,
  resolvePiSearchKey,
} from '@/executor/handlers/pi/keys'
import { runLocalPi } from '@/executor/handlers/pi/local-backend'
import { buildPiSearchToolSpec } from '@/executor/handlers/pi/search/tool'
import { buildSimToolSpecs } from '@/executor/handlers/pi/sim-tools'
import type {
  BlockHandler,
  ExecutionContext,
  NormalizedBlockOutput,
  StreamingExecution,
} from '@/executor/types'
import { isPiSupportedProvider, resolvePiModelId } from '@/providers/pi-providers'
import { getProviderFromModel } from '@/providers/utils'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('PiBlockHandler')
const DEFAULT_MODEL = 'claude-sonnet-4-6'
const REVIEW_EVENTS = ['COMMENT', 'REQUEST_CHANGES'] as const
const MAX_REVIEW_MENTIONS = 10
const MAX_REVIEW_MENTION_LENGTH = 200
const MAX_REVIEW_MENTIONS_INPUT_LENGTH = 2_000

function asOptString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function asRawString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function isReviewEvent(value: string): value is PiCloudReviewRunParams['reviewEvent'] {
  return REVIEW_EVENTS.some((event) => event === value)
}

/**
 * Reads a `switch` subblock, tolerating the string form.
 *
 * A switch reaches a handler as `'true'`/`'false'` when its value arrived through
 * a variable reference, an API trigger payload, or a legacy serialized workflow —
 * `wait-handler` coerces the same way. Both polarities need it: a strict `=== true`
 * silently disables an enabled toggle, and a strict `!== false` silently enables a
 * disabled one.
 */
function isSwitchEnabled(value: unknown, defaultValue = false): boolean {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return defaultValue
}

function parsePiMode(value: unknown): PiRunParams['mode'] {
  if (value === 'babysit') {
    throw new Error(
      'Standalone Babysit mode was removed. Use Create PR or Update Branch with Babysit Mode enabled.'
    )
  }
  if (
    value === 'cloud' ||
    value === 'cloud_branch' ||
    value === 'cloud_review' ||
    value === 'local'
  ) {
    return value
  }
  throw new Error(`Invalid Pi mode: ${String(value)}`)
}

/** Parses the bounded, comma-separated issue comments used to request re-review. */
export function parsePiReviewMentions(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return []
  if (typeof value !== 'string') {
    throw new Error('Invalid reviewMentions: expected a comma-separated string.')
  }
  if (value.length > MAX_REVIEW_MENTIONS_INPUT_LENGTH) {
    throw new Error(
      `reviewMentions must be at most ${MAX_REVIEW_MENTIONS_INPUT_LENGTH} characters.`
    )
  }

  const mentions = value
    .split(',')
    .map((mention) => mention.trim())
    .filter(Boolean)
  if (mentions.length > MAX_REVIEW_MENTIONS) {
    throw new Error(`reviewMentions may contain at most ${MAX_REVIEW_MENTIONS} entries.`)
  }
  const tooLong = mentions.find((mention) => mention.length > MAX_REVIEW_MENTION_LENGTH)
  if (tooLong) {
    throw new Error(
      `Each reviewMentions entry must be at most ${MAX_REVIEW_MENTION_LENGTH} characters.`
    )
  }
  // Every entry becomes its own issue comment, re-posted after each pushed round, so a
  // stray comma in prose ("@cursor review this, focusing on auth") would otherwise leave
  // "focusing on auth" on the pull request once per round. Requiring a mention shape
  // turns that into a setup error before anything is posted.
  const notAMention = mentions.find((mention) => !mention.startsWith('@'))
  if (notAMention) {
    throw new Error(
      `Each reviewMentions entry must start with "@" — got "${notAMention}". Separate reviewers with commas, and avoid commas inside a single mention.`
    )
  }
  return mentions
}

export class PiBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.PI
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput | StreamingExecution> {
    const mode = parsePiMode(inputs.mode)
    const task = asOptString(inputs.task)
    if (!task) throw new Error('Task is required')
    const model = asOptString(inputs.model) ?? DEFAULT_MODEL

    const providerId = getProviderFromModel(model)
    if (!isPiSupportedProvider(providerId)) {
      throw new Error(`Pi provider "${providerId}" is not supported`)
    }
    const piModel = resolvePiModelId(providerId, model)
    if (!piModel) {
      throw new Error(
        `Pi model "${model}" is not available for provider "${providerId}" in the installed Pi catalog`
      )
    }

    const { apiKey, isBYOK } = await resolvePiModelKey({
      providerId,
      model,
      mode,
      workspaceId: ctx.workspaceId,
      apiKey: asRawString(inputs.apiKey),
    })

    const search = await this.resolveSearch(ctx, inputs, mode)

    const base = {
      model,
      piModel,
      providerId,
      apiKey,
      isBYOK,
      task,
      thinkingLevel: asOptString(inputs.thinkingLevel),
      ...(search ? { search } : {}),
    }

    if (mode === 'cloud_review') {
      const owner = asOptString(inputs.owner)
      const repo = asOptString(inputs.repo)
      const githubToken = asRawString(inputs.githubToken)
      const pullNumber = parseOptionalNumberInput(inputs.pullNumber, 'pullNumber', {
        integer: true,
        min: 1,
      })
      if (!owner || !repo || !githubToken || pullNumber === undefined) {
        throw new Error(
          'Review Code requires repository owner, name, a GitHub token, and a pull request number'
        )
      }
      const reviewEventRaw = asOptString(inputs.reviewEvent) ?? 'COMMENT'
      if (!isReviewEvent(reviewEventRaw)) {
        throw new Error(`Invalid review event: ${reviewEventRaw}. Use COMMENT or REQUEST_CHANGES.`)
      }
      const params: PiCloudReviewRunParams = {
        ...base,
        mode: 'cloud_review',
        owner,
        repo,
        githubToken,
        pullNumber,
        reviewEvent: reviewEventRaw,
      }
      return this.runPi(ctx, block, runCloudReviewPi, params)
    }
    const skills = await resolvePiSkills(inputs.skills, ctx.workspaceId)

    const memoryConfig: PiMemoryConfig = {
      memoryType: asOptString(inputs.memoryType) as PiMemoryConfig['memoryType'],
      conversationId: asOptString(inputs.conversationId),
      slidingWindowSize: asOptString(inputs.slidingWindowSize),
      slidingWindowTokens: asOptString(inputs.slidingWindowTokens),
      model,
    }
    const contextualBase = {
      ...base,
      skills,
      initialMessages: await loadPiMemory(ctx, memoryConfig),
    }

    if (mode === 'local') {
      const host = asOptString(inputs.host)
      const username = asOptString(inputs.username)
      const repoPath = asOptString(inputs.repoPath)
      if (!host || !username || !repoPath) {
        throw new Error('Local Dev requires host, username, and repository path')
      }
      const usePrivateKey = inputs.authMethod === 'privateKey'
      const port = parseOptionalNumberInput(inputs.port, 'port', { integer: true, min: 1 }) ?? 22
      const tools = await buildSimToolSpecs(ctx, inputs.tools)
      const params: PiLocalRunParams = {
        ...contextualBase,
        mode: 'local',
        repoPath,
        tools,
        ssh: {
          host,
          port,
          username,
          password: usePrivateKey ? undefined : asRawString(inputs.password),
          privateKey: usePrivateKey ? asRawString(inputs.privateKey) : undefined,
          passphrase: usePrivateKey ? asRawString(inputs.passphrase) : undefined,
        },
      }
      return this.runPi(ctx, block, runLocalPi, params, memoryConfig)
    }

    const owner = asOptString(inputs.owner)
    const repo = asOptString(inputs.repo)
    const githubToken = asRawString(inputs.githubToken)
    if (!owner || !repo || !githubToken) {
      const label = mode === 'cloud_branch' ? 'Update Branch' : 'Create PR'
      throw new Error(`${label} requires repository owner, name, and a GitHub token`)
    }
    // A `switch` subblock reaches a handler as the string 'true' when its value came
    // through a variable reference, an API trigger payload, or a legacy serialized
    // workflow (see the same coercion in `wait-handler`). A strict boolean compare
    // silently opened a draft PR and skipped Babysit entirely while the editor showed
    // the toggle on and Reviewer Mentions as required.
    const babysitMode = isSwitchEnabled(inputs.babysitMode)
    const reviewMentions = babysitMode ? parsePiReviewMentions(inputs.reviewMentions) : []
    if (babysitMode && reviewMentions.length === 0) {
      const label = mode === 'cloud_branch' ? 'Update Branch' : 'Create PR'
      throw new Error(`${label} Babysit Mode requires at least one reviewer mention`)
    }
    const maxRounds = babysitMode
      ? (parseOptionalNumberInput(inputs.maxRounds, 'maxRounds', {
          integer: true,
          min: 1,
          max: 10,
        }) ?? 3)
      : undefined

    if (mode === 'cloud_branch') {
      const targetBranch = asOptString(inputs.targetBranch)
      if (!targetBranch) {
        throw new Error('Update Branch requires a target branch')
      }
      const params: PiCloudBranchRunParams = {
        ...contextualBase,
        mode: 'cloud_branch',
        owner,
        repo,
        githubToken,
        targetBranch,
        ...(babysitMode
          ? {
              babysit: {
                maxRounds: maxRounds ?? 3,
                reviewMentions,
                ...(ctx.executionId ? { executionId: ctx.executionId } : {}),
              },
            }
          : {}),
      }
      return this.runPi(ctx, block, runCloudBranchPi, params, memoryConfig)
    }
    const params: PiCloudRunParams = {
      ...contextualBase,
      mode: 'cloud',
      owner,
      repo,
      githubToken,
      baseBranch: asOptString(inputs.baseBranch),
      branchName: asOptString(inputs.branchName),
      // `draft` defaults on, so the negative form is the one that must tolerate the
      // string: `'false'` from a variable reference would otherwise read as truthy
      // and open a draft PR against the user's explicit setting.
      draft: babysitMode ? false : isSwitchEnabled(inputs.draft, true),
      prTitle: asOptString(inputs.prTitle),
      prBody: asOptString(inputs.prBody),
      ...(babysitMode
        ? {
            babysit: {
              maxRounds: maxRounds ?? 3,
              reviewMentions,
              ...(ctx.executionId ? { executionId: ctx.executionId } : {}),
            },
          }
        : {}),
    }
    return this.runPi(ctx, block, runCloudPi, params, memoryConfig)
  }

  /**
   * Resolves optional web search before mode dispatch, so a missing key fails the run with a setup
   * error instead of after a sandbox and a clone have been paid for.
   *
   * The host-side tool is built here rather than in a backend because it needs the
   * {@link ExecutionContext}, which backends never receive — they see only `{ onEvent, signal }`.
   * Cloud authoring gets no host tool: it registers a sandbox extension instead, so a spec built
   * here could never execute.
   */
  private async resolveSearch(
    ctx: ExecutionContext,
    inputs: Record<string, any>,
    mode: PiRunParams['mode']
  ): Promise<PiSearchConfig | undefined> {
    const provider = parsePiSearchProvider(inputs.searchProvider)
    if (provider === 'none') return undefined

    const { label, toolId } = PI_SEARCH_PROVIDERS[provider]

    // Authorization before credentials, which is the order `executeTool` itself uses and is
    // observable: reversed, a denied user's stored key is fetched and decrypted and they are told to
    // add a key instead of being denied. The preflight is also the only denylist check cloud
    // authoring gets, because its extension calls the provider directly and never reaches
    // `executeTool`.
    try {
      await assertPermissionsAllowed({
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        toolId,
        ctx,
      })
    } catch (error) {
      if (error instanceof ToolNotAllowedError) {
        throw new Error(
          `${label} search is not allowed based on your permission group settings. Set Internet Search to None or ask an admin to allow it.`
        )
      }
      throw error
    }

    const apiKey = resolvePiSearchKey({
      provider,
      apiKey: asOptString(inputs.searchApiKey),
    })

    const credentials = { provider, apiKey }
    return mode === 'cloud' || mode === 'cloud_branch'
      ? credentials
      : { ...credentials, tool: buildPiSearchToolSpec(ctx, credentials, mode) }
  }

  private isContentSelectedForStreaming(ctx: ExecutionContext, block: SerializedBlock): boolean {
    if (!ctx.stream) return false
    return (
      ctx.selectedOutputs?.some((outputId) => {
        if (outputId === block.id) return true
        return outputId === `${block.id}.content` || outputId === `${block.id}_content`
      }) ?? false
    )
  }

  private buildOutput(
    result: PiRunResult,
    model: string,
    isBYOK: boolean,
    startTime: number,
    startTimeISO: string
  ): NormalizedBlockOutput {
    const { totals } = result
    const endTime = Date.now()
    return {
      content: totals.finalText,
      model,
      changedFiles: result.changedFiles ?? [],
      diff: result.diff ?? '',
      ...(result.prUrl ? { prUrl: result.prUrl } : {}),
      ...(result.branch ? { branch: result.branch } : {}),
      ...(result.reviewUrl ? { reviewUrl: result.reviewUrl } : {}),
      ...(typeof result.commentsPosted === 'number'
        ? { commentsPosted: result.commentsPosted }
        : {}),
      ...(typeof result.rounds === 'number' ? { rounds: result.rounds } : {}),
      ...(typeof result.threadsClean === 'boolean' ? { threadsClean: result.threadsClean } : {}),
      ...(typeof result.checksGreen === 'boolean' ? { checksGreen: result.checksGreen } : {}),
      ...(typeof result.threadsResolved === 'number'
        ? { threadsResolved: result.threadsResolved }
        : {}),
      ...(typeof result.commitsPushed === 'number' ? { commitsPushed: result.commitsPushed } : {}),
      ...(typeof result.stopReason === 'string' ? { stopReason: result.stopReason } : {}),
      tokens: {
        input: totals.inputTokens,
        output: totals.outputTokens,
        total: totals.inputTokens + totals.outputTokens,
      },
      cost: computePiCost(model, totals.inputTokens, totals.outputTokens, isBYOK),
      providerTiming: {
        startTime: startTimeISO,
        endTime: new Date(endTime).toISOString(),
        duration: endTime - startTime,
      },
    }
  }

  private async runPi<P extends PiRunParams>(
    ctx: ExecutionContext,
    block: SerializedBlock,
    backend: PiBackendRun<P>,
    params: P,
    memoryConfig?: PiMemoryConfig
  ): Promise<BlockOutput | StreamingExecution> {
    const startTime = Date.now()
    const startTimeISO = new Date(startTime).toISOString()

    logger.info('Executing Pi block', {
      blockId: block.id,
      mode: params.mode,
      model: params.model,
      workflowId: ctx.workflowId,
      executionId: ctx.executionId,
    })

    if (this.isContentSelectedForStreaming(ctx, block)) {
      const output: NormalizedBlockOutput = { content: '', model: params.model }
      const stream = new ReadableStream<Uint8Array>({
        start: async (controller) => {
          const encoder = new TextEncoder()
          try {
            const result = await backend(params, {
              onEvent: (event) => {
                const text = streamTextForEvent(event)
                if (text) controller.enqueue(encoder.encode(text))
              },
              signal: ctx.abortSignal,
            })
            if (result.totals.errorMessage) {
              controller.error(new Error(result.totals.errorMessage))
              return
            }
            Object.assign(
              output,
              this.buildOutput(result, params.model, params.isBYOK, startTime, startTimeISO)
            )
            if (memoryConfig) {
              await appendPiMemory(
                ctx,
                memoryConfig,
                params.task,
                result.memoryText ?? result.totals.finalText
              )
            }
            controller.close()
          } catch (error) {
            controller.error(error)
          }
        },
      })

      return {
        stream,
        execution: {
          success: true,
          output,
          blockId: block.id,
          logs: [],
          metadata: { startTime: startTimeISO, duration: 0 },
          isStreaming: true,
        } as StreamingExecution['execution'] & { blockId: string },
      }
    }

    const result = await backend(params, { onEvent: () => {}, signal: ctx.abortSignal })
    if (result.totals.errorMessage) {
      throw new Error(result.totals.errorMessage)
    }
    if (memoryConfig) {
      await appendPiMemory(
        ctx,
        memoryConfig,
        params.task,
        result.memoryText ?? result.totals.finalText
      )
    }
    return this.buildOutput(result, params.model, params.isBYOK, startTime, startTimeISO)
  }
}
