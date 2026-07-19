/**
 * Executor handler for the Pi Coding Agent block. Resolves the model key,
 * skills, and memory, selects a backend by `mode`, and runs it — streaming the
 * agent's text to the client when the block is selected for streaming output,
 * otherwise returning a plain block output. The handler depends only on the
 * {@link PiBackendRun} seam and never reaches into backend internals.
 */

import { createLogger } from '@sim/logger'
import type { BlockOutput } from '@/blocks/types'
import { parseOptionalNumberInput } from '@/blocks/utils'
import { BlockType } from '@/executor/constants'
import type {
  PiBackendRun,
  PiCloudRunParams,
  PiLocalRunParams,
  PiRunParams,
  PiRunResult,
} from '@/executor/handlers/pi/backend'
import { runCloudPi } from '@/executor/handlers/pi/cloud-backend'
import {
  appendPiMemory,
  loadPiMemory,
  type PiMemoryConfig,
  resolvePiSkills,
} from '@/executor/handlers/pi/context'
import { streamTextForEvent } from '@/executor/handlers/pi/events'
import { computePiCost, resolvePiModelKey } from '@/executor/handlers/pi/keys'
import { runLocalPi } from '@/executor/handlers/pi/local-backend'
import { buildSimToolSpecs } from '@/executor/handlers/pi/sim-tools'
import type {
  BlockHandler,
  ExecutionContext,
  NormalizedBlockOutput,
  StreamingExecution,
} from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('PiBlockHandler')
const DEFAULT_MODEL = 'claude-sonnet-5'

function asOptString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function asRawString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
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
    const task = asOptString(inputs.task)
    if (!task) throw new Error('Task is required')
    const model = asOptString(inputs.model) ?? DEFAULT_MODEL

    // Validate the mode up front so an invalid value reports a mode error rather
    // than a misattributed credential error from key resolution below.
    if (inputs.mode !== 'cloud' && inputs.mode !== 'local') {
      throw new Error(`Invalid Pi mode: ${String(inputs.mode)}`)
    }
    const mode: 'cloud' | 'local' = inputs.mode

    const { providerId, apiKey, isBYOK } = await resolvePiModelKey({
      model,
      mode,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      apiKey: asRawString(inputs.apiKey),
      vertexCredential: asOptString(inputs.vertexCredential),
    })

    const skills = await resolvePiSkills(inputs.skills, ctx.workspaceId)
    const memoryConfig: PiMemoryConfig = {
      memoryType: asOptString(inputs.memoryType) as PiMemoryConfig['memoryType'],
      conversationId: asOptString(inputs.conversationId),
      slidingWindowSize: asOptString(inputs.slidingWindowSize),
      slidingWindowTokens: asOptString(inputs.slidingWindowTokens),
      model,
    }
    const initialMessages = await loadPiMemory(ctx, memoryConfig)

    const base = {
      model,
      providerId,
      apiKey,
      isBYOK,
      task,
      thinkingLevel: asOptString(inputs.thinkingLevel),
      skills,
      initialMessages,
    }

    if (mode === 'local') {
      const host = asOptString(inputs.host)
      const username = asOptString(inputs.username)
      const repoPath = asOptString(inputs.repoPath)
      if (!host || !username || !repoPath) {
        throw new Error('Local mode requires host, username, and repository path')
      }
      const usePrivateKey = inputs.authMethod === 'privateKey'
      const port = parseOptionalNumberInput(inputs.port, 'port', { integer: true, min: 1 }) ?? 22
      const tools = await buildSimToolSpecs(ctx, inputs.tools)
      const params: PiLocalRunParams = {
        ...base,
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

    if (mode === 'cloud') {
      const owner = asOptString(inputs.owner)
      const repo = asOptString(inputs.repo)
      const githubToken = asRawString(inputs.githubToken)
      if (!owner || !repo || !githubToken) {
        throw new Error('Cloud mode requires repository owner, name, and a GitHub token')
      }
      const params: PiCloudRunParams = {
        ...base,
        mode: 'cloud',
        owner,
        repo,
        githubToken,
        baseBranch: asOptString(inputs.baseBranch),
        branchName: asOptString(inputs.branchName),
        draft: inputs.draft !== false,
        prTitle: asOptString(inputs.prTitle),
        prBody: asOptString(inputs.prBody),
      }
      return this.runPi(ctx, block, runCloudPi, params, memoryConfig)
    }

    throw new Error(`Invalid Pi mode: ${String(inputs.mode)}`)
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
    memoryConfig: PiMemoryConfig
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
            await appendPiMemory(ctx, memoryConfig, params.task, result.totals.finalText)
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
    await appendPiMemory(ctx, memoryConfig, params.task, result.totals.finalText)

    return this.buildOutput(result, params.model, params.isBYOK, startTime, startTimeISO)
  }
}
