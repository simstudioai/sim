/** Executor handler for the sandboxed Codex Coding Agent block. */

import { createLogger } from '@sim/logger'
import { getBYOKKey } from '@/lib/api-key/byok'
import { type CodexConfigPatch, parseCodexConfigPatch } from '@/lib/codex/config'
import { projectResolvedModelInput } from '@/lib/execution/model-input-provenance'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/constants'
import { runCloudCodex } from '@/executor/handlers/codex/cloud/authoring'
import { runCloudPlanCodex } from '@/executor/handlers/codex/cloud/plan'
import { validateGitHubRepositoryPart } from '@/executor/handlers/codex/cloud/shared'
import type {
  CodexBackendRun,
  CodexCloudPlanRunParams,
  CodexCloudRunParams,
  CodexRunParams,
  CodexRunResult,
} from '@/executor/handlers/codex/core/backend'
import { resolveExecutionCodexConfig } from '@/executor/handlers/codex/core/config'
import { streamTextForCodexEvent } from '@/executor/handlers/codex/core/events'
import { parseCodexAgentId, withCodexAgentTurn } from '@/executor/handlers/codex/core/session'
import type {
  BlockHandler,
  ExecutionContext,
  NormalizedBlockOutput,
  StreamingExecution,
} from '@/executor/types'
import { refuseResolvedSecretProjection } from '@/executor/utils/resolved-secret-projection-refusal'
import { parseCodexModel, parseCodexReasoningEffort } from '@/providers/codex'
import { calculateBillableModelCost } from '@/providers/cost-policy'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('CodexBlockHandler')

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function asRawString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function isSwitchEnabled(value: unknown, defaultValue = false): boolean {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return defaultValue
}

function parseCodexMode(value: unknown): CodexRunParams['mode'] {
  if (value === 'cloud' || value === 'cloud_plan') return value
  throw new Error(`Invalid Codex mode: ${String(value)}`)
}

function hasConfiguredValue(inputs: Record<string, unknown>, field: string): boolean {
  if (!Object.hasOwn(inputs, field)) return false
  const value = inputs[field]
  return value !== undefined && value !== null && value !== ''
}

/** Maps pre-overlay block fields into the compatibility layer without manufacturing defaults. */
function legacyAgentPatch(inputs: Record<string, unknown>): CodexConfigPatch {
  const patch: CodexConfigPatch = {}
  if (hasConfiguredValue(inputs, 'mode')) patch.mode = parseCodexMode(inputs.mode)
  if (hasConfiguredValue(inputs, 'model')) patch.model = parseCodexModel(inputs.model)

  const owner = asOptionalString(inputs.owner)
  const repo = asOptionalString(inputs.repo)
  const baseBranch = asOptionalString(inputs.baseBranch)
  if (owner) patch.owner = owner
  if (repo) patch.repo = repo
  if (baseBranch) patch.baseBranch = baseBranch
  if (hasConfiguredValue(inputs, 'networkAccess')) {
    patch.networkAccess = isSwitchEnabled(inputs.networkAccess)
  }
  return patch
}

function embeddedAgentPatch(value: unknown): CodexConfigPatch {
  if (typeof value !== 'string') return parseCodexConfigPatch(value)
  const trimmed = value.trim()
  if (!trimmed) return {}
  try {
    return parseCodexConfigPatch(JSON.parse(trimmed))
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Invalid embedded Codex Agent configuration')
    throw error
  }
}

async function resolveOpenAIKey(ctx: ExecutionContext, value: unknown): Promise<string> {
  const direct = asRawString(value)?.trim()
  if (direct) return direct
  const byok = await getBYOKKey(ctx.workspaceId, 'openai')
  if (byok) return byok.apiKey
  throw new Error(
    'Codex requires your own OpenAI API key. Enter it in the block, or store one in Settings > BYOK.'
  )
}

export class CodexBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.CODEX
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput | StreamingExecution> {
    const resolvedTask = asOptionalString(inputs.task)
    if (!resolvedTask) throw new Error('Task is required')
    const projection = projectResolvedModelInput(
      ctx.resolvedSecretTraceRegistry,
      { task: resolvedTask },
      [['task']]
    )
    if (!projection.complete || typeof projection.value.task !== 'string') {
      refuseResolvedSecretProjection({
        site: 'codex.taskModelInput',
        message: 'Codex input could not be safely projected',
        registry: ctx.resolvedSecretTraceRegistry,
        inputPath: 'task',
      })
    }

    const agentId = parseCodexAgentId(inputs.agentId, block.id)
    const stepPatch: CodexConfigPatch = {}
    if (hasConfiguredValue(inputs, 'reasoningEffort')) {
      stepPatch.reasoningEffort = parseCodexReasoningEffort(inputs.reasoningEffort)
    }
    const { config } = await resolveExecutionCodexConfig(ctx, {
      agentId,
      legacyStep: legacyAgentPatch(inputs),
      embeddedAgent: embeddedAgentPatch(inputs.agentConfig),
      step: stepPatch,
    })

    const mode = config.mode
    const owner = config.owner
    const repo = config.repo
    const githubToken = asRawString(inputs.githubToken)
    if (!owner || !repo || !githubToken) {
      throw new Error(
        `${mode === 'cloud_plan' ? 'Plan' : 'Create PR'} requires repository owner, name, and a GitHub token`
      )
    }

    const base = {
      agentId,
      model: config.model,
      apiKey: await resolveOpenAIKey(ctx, inputs.apiKey),
      task: projection.value.task,
      reasoningEffort: config.reasoningEffort,
      networkAccess: config.networkAccess,
      owner: validateGitHubRepositoryPart(owner, 'owner'),
      repo: validateGitHubRepositoryPart(repo, 'repository name'),
      githubToken,
      baseBranch: config.baseBranch,
    }

    if (mode === 'cloud_plan') {
      const params: CodexCloudPlanRunParams = { ...base, mode }
      return this.runCodex(ctx, block, runCloudPlanCodex, params)
    }

    const params: CodexCloudRunParams = {
      ...base,
      mode,
      branchName: asOptionalString(inputs.branchName),
      draft: isSwitchEnabled(inputs.draft, true),
      prTitle: asOptionalString(inputs.prTitle),
      prBody: asOptionalString(inputs.prBody),
    }
    return this.runCodex(ctx, block, runCloudCodex, params)
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
    result: CodexRunResult,
    params: CodexRunParams,
    startTime: number,
    startTimeISO: string
  ): NormalizedBlockOutput {
    const { totals } = result
    const endTime = Date.now()
    return {
      content: totals.finalText,
      model: params.model,
      runStatus: result.status,
      agentId: result.agentId,
      sessionReused: result.sessionReused,
      turnNumber: result.turnNumber,
      ...(totals.threadId ? { threadId: totals.threadId } : {}),
      ...(params.mode === 'cloud_plan'
        ? {}
        : { changedFiles: result.changedFiles ?? [], diff: result.diff ?? '' }),
      ...(result.prUrl ? { prUrl: result.prUrl } : {}),
      ...(result.branch ? { branch: result.branch } : {}),
      commands: totals.toolCalls,
      tokens: {
        input: totals.inputTokens,
        cacheRead: totals.cachedInputTokens,
        cacheWrite: totals.cacheWriteInputTokens,
        output: totals.outputTokens,
        reasoning: totals.reasoningOutputTokens,
        total: totals.inputTokens + totals.outputTokens,
      },
      cost: calculateBillableModelCost(params.model, totals.inputTokens, totals.outputTokens, {
        isBYOK: true,
      }),
      providerTiming: {
        startTime: startTimeISO,
        endTime: new Date(endTime).toISOString(),
        duration: endTime - startTime,
      },
    }
  }

  private async runCodex<P extends CodexRunParams>(
    ctx: ExecutionContext,
    block: SerializedBlock,
    backend: CodexBackendRun<P>,
    params: P
  ): Promise<BlockOutput | StreamingExecution> {
    const startTime = Date.now()
    const startTimeISO = new Date(startTime).toISOString()
    logger.info('Executing Codex block', {
      blockId: block.id,
      mode: params.mode,
      model: params.model,
      workflowId: ctx.workflowId,
      executionId: ctx.executionId,
      agentId: params.agentId,
    })

    const runTurn = (onEvent: Parameters<CodexBackendRun<P>>[1]['onEvent']) =>
      withCodexAgentTurn(
        ctx,
        {
          agentId: params.agentId,
          mode: params.mode,
          model: params.model,
          owner: params.owner,
          repo: params.repo,
          baseBranch: params.baseBranch,
        },
        async ({ session, sessionReused, turnNumber }) => {
          const result = await backend(params, {
            onEvent,
            signal: ctx.abortSignal,
            session,
          })
          return {
            ...result,
            agentId: params.agentId,
            sessionReused,
            turnNumber,
          }
        }
      )

    if (this.isContentSelectedForStreaming(ctx, block)) {
      const output: NormalizedBlockOutput = { content: '', model: params.model }
      const stream = new ReadableStream<Uint8Array>({
        start: async (controller) => {
          const encoder = new TextEncoder()
          try {
            const result = await runTurn((event) => {
              if (params.mode === 'cloud_plan') return
              const text = streamTextForCodexEvent(event)
              if (text) controller.enqueue(encoder.encode(text))
            })
            if (params.mode === 'cloud_plan') {
              controller.enqueue(encoder.encode(result.totals.finalText))
            }
            Object.assign(output, this.buildOutput(result, params, startTime, startTimeISO))
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

    const result = await runTurn(() => {})
    return this.buildOutput(result, params, startTime, startTimeISO)
  }
}
