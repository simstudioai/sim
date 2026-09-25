import { isDeepStrictEqual } from 'node:util'
import { resolvePrincipalSubject } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { decryptSecret } from '@/lib/core/security/encryption'
import { stringifyBoundedJson } from '@/lib/core/utils/bounded-json'
import {
  bindDurableSecretProvenanceToValue,
  durableSecretProvenanceFromRegistry,
  EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
  importDurableSecretProvenance,
  normalizeDurableSecretProvenanceEntries,
} from '@/lib/execution/durable-secret-provenance'
import { isLargeValueRef, type LargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import { redactObjectStrings } from '@/lib/logs/execution/pii-redaction'
import {
  openAgentMemoryTurnUseCase,
  readAgentMemoryArtifactUseCase,
  saveAgentMemoryTurnUseCase,
  storeAgentMemoryArtifactUseCase,
} from '@/lib/memory/application/agent-turns'
import { MEMORY_DELEGATION_AUDIENCE } from '@/lib/memory/application/authorization'
import { getMemoryArtifactHandle } from '@/lib/memory/artifact-handle'
import {
  decryptMemoryCheckpoint,
  encryptMemoryCheckpoint,
  projectableMemoryCheckpoint,
} from '@/lib/memory/checkpoint-codec'
import { MEMORY } from '@/lib/memory/constants'
import type {
  AgentMemoryTurnIdentity,
  AgentMemoryTurnRecord,
  ConversationItemInput,
} from '@/lib/memory/conversation-store'
import type {
  AgentTurnState,
  ConversationStep,
  ConversationToolResult,
} from '@/lib/memory/conversation-types'
import { AgentTurnJournal } from '@/lib/memory/turn-journal'
import { AgentTurnStateMachine, renderConversationStep } from '@/lib/memory/turn-state'
import type { ExecutionContext } from '@/executor/types'
import {
  projectResolvedSecretModelContent,
  projectResolvedSecretModelJsonStrings,
} from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { providerHistoryProtocols } from '@/providers/history-adapters'

const logger = createLogger('AgentMemory')
const MAX_CACHED_AGENT_TURNS = 32
const MAX_ARTIFACT_PREVIEW_CHARS = 8000
const sessions = new WeakMap<ExecutionContext, Map<string, AgentTurnSession>>()

export interface OpenAgentTurnSessionInput {
  ctx: ExecutionContext
  blockId: string
  nodeId: string
  executionOrder: number
  conversationId: string
}

function validProvenance(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecordLike(value) &&
      (value.status === 'unknown' ||
        (value.status === 'exact' &&
          normalizeDurableSecretProvenanceEntries(value.entries) !== undefined)))
  )
}

function validNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function validState(value: unknown): value is AgentTurnState {
  if (
    !isRecordLike(value) ||
    value.version !== 1 ||
    !Array.isArray(value.steps) ||
    value.steps.length > 1000
  )
    return false
  if (
    value.final !== undefined &&
    (!isRecordLike(value.final) ||
      typeof value.final.content !== 'string' ||
      typeof value.final.model !== 'string' ||
      !value.final.model)
  )
    return false
  if (value.contextUsage !== undefined) {
    const usage = value.contextUsage
    if (
      !isRecordLike(usage) ||
      !isRecordLike(usage.tokens) ||
      !isRecordLike(usage.cost) ||
      !validNumber(usage.tokens.input) ||
      !validNumber(usage.tokens.output) ||
      (usage.tokens.cacheRead !== undefined && !validNumber(usage.tokens.cacheRead)) ||
      (usage.tokens.cacheWrite !== undefined && !validNumber(usage.tokens.cacheWrite)) ||
      !['input', 'output', 'total', 'toolCost'].every((key) =>
        validNumber((usage.cost as Record<string, unknown>)[key])
      )
    )
      return false
  }
  const stepIds = new Set<string>()
  const invocationIds = new Set<string>()
  return value.steps.every((step) => {
    if (
      !isRecordLike(step) ||
      typeof step.id !== 'string' ||
      !step.id ||
      stepIds.has(step.id) ||
      !isRecordLike(step.assistant) ||
      step.assistant.role !== 'assistant' ||
      typeof step.assistant.content !== 'string' ||
      Object.keys(step.assistant).some((key) => key !== 'role' && key !== 'content') ||
      !Array.isArray(step.calls) ||
      step.calls.length > 1000 ||
      !Array.isArray(step.results) ||
      step.results.length > step.calls.length ||
      !validProvenance(step.provenance) ||
      (step.historyUnavailable !== undefined && typeof step.historyUnavailable !== 'boolean')
    )
      return false
    stepIds.add(step.id)
    const callIds = new Set<string>()
    const providerIds = new Set<string>()
    for (const call of step.calls) {
      if (
        !isRecordLike(call) ||
        typeof call.invocationId !== 'string' ||
        !call.invocationId ||
        invocationIds.has(call.invocationId) ||
        typeof call.toolId !== 'string' ||
        !call.toolId ||
        typeof call.arguments !== 'string' ||
        (call.modelArguments !== undefined && typeof call.modelArguments !== 'string') ||
        (call.configuredToolBinding !== undefined &&
          (typeof call.configuredToolBinding !== 'string' || !call.configuredToolBinding)) ||
        (call.providerCallId !== undefined &&
          (typeof call.providerCallId !== 'string' ||
            !call.providerCallId ||
            providerIds.has(call.providerCallId)))
      )
        return false
      invocationIds.add(call.invocationId)
      callIds.add(call.invocationId)
      if (call.providerCallId) providerIds.add(call.providerCallId)
    }
    const resultIds = new Set<string>()
    for (const result of step.results) {
      if (
        !isRecordLike(result) ||
        typeof result.invocationId !== 'string' ||
        !callIds.has(result.invocationId) ||
        resultIds.has(result.invocationId) ||
        !validProvenance(result.provenance) ||
        (result.artifact !== undefined && !isLargeValueRef(result.artifact))
      )
        return false
      for (const response of [result.rawResponse, result.modelResponse]) {
        if (
          !isRecordLike(response) ||
          typeof response.success !== 'boolean' ||
          !isRecordLike(response.output) ||
          (response.error !== undefined && typeof response.error !== 'string')
        )
          return false
      }
      resultIds.add(result.invocationId)
    }
    if (value.final !== undefined && resultIds.size !== callIds.size) return false
    if (step.native !== undefined) {
      const native = step.native
      if (
        !isRecordLike(native) ||
        typeof native.providerId !== 'string' ||
        !Object.hasOwn(providerHistoryProtocols, native.providerId) ||
        typeof native.model !== 'string' ||
        !native.model ||
        typeof native.binding !== 'string' ||
        !native.binding ||
        !Object.hasOwn(native, 'value') ||
        (native.prefixHash !== undefined &&
          (typeof native.prefixHash !== 'string' || !/^[a-f0-9]{64}$/.test(native.prefixHash)))
      )
        return false
      const protocol =
        providerHistoryProtocols[native.providerId as keyof typeof providerHistoryProtocols]
      if (
        native.protocol !== protocol &&
        !(native.providerId === 'azure-openai' && native.protocol === 'chat-completions')
      )
        return false
    }
    if (
      step.cost !== undefined &&
      (!isRecordLike(step.cost) ||
        !['input', 'output', 'total'].every((key) =>
          validNumber((step.cost as Record<string, unknown>)[key])
        ))
    )
      return false
    if (step.usage !== undefined) {
      const usage = step.usage
      if (
        !isRecordLike(usage) ||
        !validNumber(usage.input) ||
        !validNumber(usage.output) ||
        (usage.cacheRead !== undefined && !validNumber(usage.cacheRead)) ||
        (usage.cacheWrite !== undefined && !validNumber(usage.cacheWrite)) ||
        (usage.cacheWrites !== undefined &&
          (!Array.isArray(usage.cacheWrites) ||
            usage.cacheWrites.some(
              (write) =>
                !isRecordLike(write) ||
                !validNumber(write.tokens) ||
                !validNumber(write.inputRateMultiplier)
            )))
      )
        return false
    }
    return true
  })
}

/** The immutable artifact retains the full result; all model continuations use this bounded view. */
function compactArtifactResult(
  result: ConversationToolResult,
  ref: LargeValueRef
): ConversationToolResult {
  const preview = truncate(
    JSON.stringify(result.modelResponse),
    MAX_ARTIFACT_PREVIEW_CHARS,
    '… [remaining tool result retained in the conversation artifact]'
  )
  const originalCost = isRecordLike(result.rawResponse.output.cost)
    ? result.rawResponse.output.cost.total
    : undefined
  const modelResponse = {
    success: result.modelResponse.success,
    output: { memoryArtifact: { id: getMemoryArtifactHandle(ref.key!) }, preview },
    ...(result.modelResponse.error
      ? { error: 'Tool execution failed; details retained in the conversation artifact.' }
      : {}),
  }
  return {
    ...result,
    artifact: ref,
    modelResponse,
    rawResponse: {
      ...modelResponse,
      success: result.rawResponse.success,
      output: {
        ...modelResponse.output,
        ...(validNumber(originalCost) ? { cost: { total: originalCost } } : {}),
      },
    },
  }
}

export class AgentTurnSession extends AgentTurnStateMachine {
  constructor(
    readonly turnId: string,
    writer: ConstructorParameters<typeof AgentTurnStateMachine>[0],
    state?: AgentTurnState,
    readonly memoryId?: string,
    private readonly restoreResult?: (
      result: ConversationToolResult
    ) => Promise<ConversationToolResult>,
    private readonly replayScope?: { workspaceId: string; userId?: string },
    private readonly prepareFinalContent?: (content: string) => Promise<string | undefined>
  ) {
    super(writer, state)
  }

  override async getReplayResult(
    invocationId: string
  ): Promise<ConversationToolResult | undefined> {
    const result = this.getRecordedResult(invocationId)
    return result?.artifact && this.restoreResult ? this.restoreResult(result) : result
  }

  override async finalize(content: string, model: string): Promise<void> {
    if (this.getFinalResponse()) return
    const projected = this.prepareFinalContent ? await this.prepareFinalContent(content) : content
    if (projected !== undefined) await super.finalize(projected, model)
  }

  /** Restores exact result-derived placeholder grants without admitting unrelated catalog names. */
  async restoreProvenance(registry: ResolvedSecretTraceRegistry): Promise<void> {
    const targetScope = registry.exportProvenance().scope
    for (const step of this.state.steps) {
      for (const result of step.results) {
        if (
          result.provenance &&
          (result.provenance.status === 'unknown' ||
            result.provenance.entries.some((entry) =>
              entry.sourceWorkspaceId !== undefined
                ? entry.sourceWorkspaceId !== this.replayScope?.workspaceId
                : !entry.sourceUserId || entry.sourceUserId !== this.replayScope?.userId
            ) ||
            !(await importDurableSecretProvenance(registry, result.provenance)))
        ) {
          throw Object.assign(
            new Error('Agent checkpoint provenance could not be safely restored'),
            { retryable: false }
          )
        }
        if (result.provenance?.status !== 'exact' || result.provenance.entries.length === 0)
          continue
        const replayed = (await this.getReplayResult(result.invocationId)) ?? result
        const projectedResult = JSON.stringify(replayed.modelResponse)
        for (const [index, entry] of result.provenance.entries.entries()) {
          const path = ['agentMemory', step.id, result.invocationId, String(index)]
          const imported = await registry.importProvenanceForValueAtInputPath(
            {
              version: 1,
              complete: true,
              entries: [
                {
                  encryptedValue: entry.encryptedValue,
                  ...(entry.name ? { name: entry.name } : {}),
                },
              ],
              ...(entry.sourceUserId
                ? {
                    scope: {
                      userId: entry.sourceUserId,
                      ...(entry.sourceWorkspaceId
                        ? { workspaceId: entry.sourceWorkspaceId }
                        : targetScope?.userId === entry.sourceUserId
                          ? { workspaceId: targetScope?.workspaceId }
                          : {}),
                    },
                  }
                : {}),
            },
            replayed.rawResponse,
            path,
            { trusted: true, origin: 'agentMemory.recordedToolResult' }
          )
          if (!imported.success || !registry.getModelEgressSnapshot().complete)
            throw Object.assign(
              new Error('Agent checkpoint provenance could not be safely restored'),
              { retryable: false }
            )
          if (imported.matched && entry.name && projectedResult.includes(`{{${entry.name}}}`)) {
            const { decrypted } = await decryptSecret(entry.encryptedValue, { logFailure: false })
            registry.recordResolvedInputProjection(path, decrypted, `{{${entry.name}}}`)
          }
        }
      }
    }
  }
}

/** Durability errors are isolated; authorization for model/tool execution remains with the executor. */
export async function openAgentTurnSession(
  input: OpenAgentTurnSessionInput
): Promise<AgentTurnSession | undefined> {
  const { ctx } = input
  if (
    !ctx.workspaceId ||
    !ctx.workflowId ||
    !ctx.executionId ||
    !Number.isSafeInteger(input.executionOrder) ||
    !input.conversationId
  )
    return undefined
  try {
    if (!(await isFeatureEnabled('agent-memory-history', { workspaceId: ctx.workspaceId })))
      return undefined
  } catch {
    logger.warn('Agent memory rollout configuration unavailable')
    return undefined
  }
  const identity: AgentMemoryTurnIdentity = {
    workspaceId: ctx.workspaceId,
    workflowId: ctx.workflowId,
    executionId: ctx.executionId,
    blockId: input.blockId,
    nodeId: input.nodeId,
    executionOrder: input.executionOrder,
    conversationId: input.conversationId,
  }
  const key = JSON.stringify(identity)
  let cache = sessions.get(ctx)
  if (!cache) {
    cache = new Map()
    sessions.set(ctx, cache)
  }
  const previous = cache.get(key)
  if (previous) {
    cache.delete(key)
    cache.set(key, previous)
    return previous
  }
  const principal = () =>
    createExecutorPrincipalFromExecutionContext({
      context: ctx,
      audience: MEMORY_DELEGATION_AUDIENCE,
    })
  let record: AgentMemoryTurnRecord | undefined
  let state: AgentTurnState | undefined
  let journal: AgentTurnJournal | undefined
  let degraded = false
  const degrade = () => {
    if (!degraded)
      logger.warn('Agent memory durability degraded', {
        executionId: ctx.executionId,
        blockId: input.blockId,
      })
    degraded = true
  }
  try {
    record = await openAgentMemoryTurnUseCase.execute({
      principal: await principal(),
      input: identity,
    })
    journal = new AgentTurnJournal(
      { identity: key, memoryId: record.memoryId, turnId: record.turnId },
      {
        async store(value) {
          const stored = await storeAgentMemoryArtifactUseCase.execute({
            principal: await principal(),
            input: {
              workspaceId: identity.workspaceId,
              workflowId: identity.workflowId,
              executionId: identity.executionId,
              memoryId: record!.memoryId,
              value,
            },
          })
          return stored?.ref
        },
        async read(ref) {
          return readAgentMemoryArtifactUseCase.execute({
            principal: await principal(),
            input: { workspaceId: identity.workspaceId, memoryId: record!.memoryId, ref },
          })
        },
        compactResult: compactArtifactResult,
        unavailable() {
          logger.warn('Agent memory recorded result payload unavailable')
        },
      }
    )
    if (record.encryptedState) {
      const restored = await decryptMemoryCheckpoint(record.encryptedState)
      if (
        !isRecordLike(restored) ||
        restored.identity !== key ||
        restored.memoryId !== record.memoryId
      )
        throw new Error('Invalid Agent checkpoint binding')
      const restoringJournal = isRecordLike(restored.state) && restored.state.version === 2
      const restoredState = restoringJournal
        ? await journal.restore(restored.state)
        : restored.state
      if (!validState(restoredState)) throw new Error('Invalid Agent checkpoint state')
      state = restoredState
    }
  } catch (error) {
    if (record?.encryptedState || (isRecordLike(error) && error.code === 'payload_too_large'))
      throw Object.assign(new Error('Agent invocation journal could not be safely restored'), {
        retryable: false,
      })
    degrade()
  }

  const project = async (value: unknown): Promise<unknown> => {
    const projected = projectResolvedSecretModelContent(value, ctx.resolvedSecretTraceRegistry)
    if (!projected.safe) throw new Error('Memory history projection unavailable')
    if (!ctx.piiBlockOutputRedaction?.enabled) return projected.value
    return redactObjectStrings(projected.value, {
      ...ctx.piiBlockOutputRedaction,
      onFailure: 'throw',
    })
  }
  const turnId = record?.turnId ?? generateId()
  const session = new AgentTurnSession(
    turnId,
    {
      async prepareStep(step) {
        try {
          const assistant = await project(step.assistant.content)
          if (typeof assistant !== 'string') throw new Error('Invalid projected assistant content')
          step.assistant.content = assistant
          const args = projectResolvedSecretModelJsonStrings(
            step.calls.map((call) => call.arguments),
            ctx.resolvedSecretTraceRegistry
          )
          if (!args.safe || !Array.isArray(args.value))
            throw new Error('Memory arguments projection unavailable')
          for (let index = 0; index < step.calls.length; index++) {
            const value: unknown = args.value[index]
            if (typeof value !== 'string') throw new Error('Invalid projected tool arguments')
            let parsed: unknown
            try {
              parsed = JSON.parse(value)
            } catch {
              parsed = value
            }
            const projected = await project(parsed)
            step.calls[index].modelArguments =
              typeof parsed === 'string' ? String(projected) : JSON.stringify(projected)
          }
          if (step.native) {
            const native = projectableMemoryCheckpoint(step.native.value)
            if (
              ctx.piiBlockOutputRedaction?.enabled ||
              !isDeepStrictEqual(await project(native), native)
            )
              step.native = undefined
          }
        } catch {
          degrade()
          step.assistant.content = '[Prior assistant content unavailable for safe replay]'
          step.native = undefined
          step.historyUnavailable = true
          for (const call of step.calls)
            call.modelArguments = '[Arguments unavailable for safe history replay]'
        }
        return step
      },
      async prepareResult(result) {
        let requiresArtifact =
          stringifyBoundedJson(result, MEMORY.MAX_MESSAGE_CONTENT_BYTES) === undefined
        let safeError: string | undefined
        try {
          const projected = await project(result.modelResponse)
          if (
            !isRecordLike(projected) ||
            typeof projected.success !== 'boolean' ||
            !isRecordLike(projected.output)
          )
            throw new Error('Invalid model result')
          if (typeof projected.error === 'string') safeError = projected.error
          const prepared: ConversationToolResult = {
            ...result,
            modelResponse: { ...result.modelResponse, ...projected },
          }
          requiresArtifact ||=
            stringifyBoundedJson(prepared, MEMORY.MAX_MESSAGE_CONTENT_BYTES) === undefined
          requiresArtifact ||=
            JSON.stringify(prepared.modelResponse).length > MAX_ARTIFACT_PREVIEW_CHARS
          if (requiresArtifact) {
            if (!record) throw new Error('Memory artifact storage unavailable')
            const stored = await storeAgentMemoryArtifactUseCase.execute({
              principal: await principal(),
              input: {
                workspaceId: identity.workspaceId,
                workflowId: identity.workflowId,
                executionId: identity.executionId,
                memoryId: record.memoryId,
                value: prepared,
              },
            })
            if (!stored) throw new Error('Memory artifact storage unavailable')
            return compactArtifactResult(prepared, stored.ref)
          }
          return prepared
        } catch {
          degrade()
          if (requiresArtifact) {
            const output = {
              memoryResultUnavailable: true,
              notice:
                'This tool already executed. Its detailed result could not be retained for replay.',
            }
            const error = safeError
              ? truncate(safeError, 1024)
              : 'Tool execution failed; recorded error details are unavailable for replay.'
            const cost = isRecordLike(result.rawResponse.output.cost)
              ? result.rawResponse.output.cost.total
              : undefined
            return {
              invocationId: result.invocationId,
              provenance: EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
              rawResponse: {
                success: result.rawResponse.success,
                output: { ...output, ...(validNumber(cost) ? { cost: { total: cost } } : {}) },
                ...(!result.rawResponse.success ? { error } : {}),
              },
              modelResponse: {
                success: result.modelResponse.success,
                output,
                ...(!result.modelResponse.success ? { error } : {}),
              },
            }
          }
          return {
            ...result,
            modelResponse: {
              success: false,
              output: {},
              error: 'Recorded tool result unavailable for safe replay',
            },
          }
        }
      },
      async save(snapshot: AgentTurnState, completed?: ConversationStep) {
        if (!record || !journal || degraded) return
        try {
          const items: ConversationItemInput[] = []
          if (snapshot.final?.content.trim()) {
            const message = { role: 'assistant' as const, content: snapshot.final.content }
            items.push({
              turnId,
              appendKey: 'final',
              kind: 'message',
              data: message,
              provenance: ctx.resolvedSecretTraceRegistry
                ? bindDurableSecretProvenanceToValue(
                    durableSecretProvenanceFromRegistry(ctx.resolvedSecretTraceRegistry, message),
                    message
                  )
                : EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
            })
          }
          if (completed?.calls.length) {
            let encryptedNative: string | undefined
            if (completed.native) {
              try {
                const candidate = await encryptMemoryCheckpoint({
                  memoryId: record.memoryId,
                  native: completed.native,
                })
                if (Buffer.byteLength(candidate) <= MEMORY.MAX_MESSAGE_CONTENT_BYTES)
                  encryptedNative = candidate
              } catch {
                logger.info(
                  'Agent memory used portable history because native state exceeded its limit'
                )
              }
            }
            let messages = renderConversationStep(completed)
            if (Buffer.byteLength(JSON.stringify(messages)) > MEMORY.MAX_MESSAGE_CONTENT_BYTES) {
              const stored = await storeAgentMemoryArtifactUseCase.execute({
                principal: await principal(),
                input: {
                  workspaceId: identity.workspaceId,
                  workflowId: identity.workflowId,
                  executionId: identity.executionId,
                  memoryId: record.memoryId,
                  value: { messages },
                },
              })
              if (!stored) throw new Error('Memory exchange artifact unavailable')
              encryptedNative = undefined
              messages = [
                {
                  role: 'user',
                  content: JSON.stringify({
                    type: 'untrusted_prior_tool_execution',
                    artifact: { id: getMemoryArtifactHandle(stored.ref.key!) },
                    preview: truncate(
                      JSON.stringify(messages),
                      MAX_ARTIFACT_PREVIEW_CHARS,
                      '… [remaining execution data retained in the conversation artifact]'
                    ),
                  }),
                },
              ]
            }
            items.push({
              appendKey: `${turnId}:step:${completed.id}`,
              kind: 'exchange',
              provenance: EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
              data: {
                version: 1,
                turnId,
                stepId: completed.id,
                messages,
                ...(encryptedNative ? { encryptedNative } : {}),
              },
            })
          }
          const encryptedState = await encryptMemoryCheckpoint({
            identity: key,
            memoryId: record.memoryId,
            state: await journal.checkpoint(snapshot),
          })
          const saved = await saveAgentMemoryTurnUseCase.execute({
            principal: await principal(),
            input: {
              ...identity,
              ...record,
              expectedRevision: record.revision,
              encryptedState,
              items,
            },
          })
          record.revision = saved.revision
        } catch {
          degrade()
        }
      },
    },
    state,
    record?.memoryId,
    async (result) => {
      if (!record || !result.artifact) return result
      try {
        const restored = await readAgentMemoryArtifactUseCase.execute({
          principal: await principal(),
          input: {
            workspaceId: identity.workspaceId,
            memoryId: record.memoryId,
            ref: result.artifact,
          },
        })
        if (
          !isRecordLike(restored) ||
          restored.invocationId !== result.invocationId ||
          !isRecordLike(restored.rawResponse) ||
          typeof restored.rawResponse.success !== 'boolean' ||
          !isRecordLike(restored.rawResponse.output) ||
          !isRecordLike(restored.modelResponse) ||
          typeof restored.modelResponse.success !== 'boolean' ||
          !isRecordLike(restored.modelResponse.output)
        )
          throw new Error('Invalid recorded tool artifact')
        return {
          ...result,
          rawResponse: { ...result.rawResponse, ...restored.rawResponse },
          modelResponse: result.modelResponse,
          provenance: result.provenance,
        }
      } catch {
        degrade()
        /** A missing artifact is a recorded terminal outcome, never permission to repeat a side effect. */
        return {
          ...result,
          rawResponse: result.modelResponse,
          provenance: EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
        }
      }
    },
    {
      workspaceId: identity.workspaceId,
      userId: (() => {
        const actor = ctx.executorDelegationOrigin?.principal
        const subject = actor ? resolvePrincipalSubject(actor) : undefined
        return subject?.kind === 'sim_user' ? subject.userId : undefined
      })(),
    },
    async (content) => {
      try {
        const projected = await project(content)
        if (
          typeof projected !== 'string' ||
          Buffer.byteLength(projected, 'utf8') > MEMORY.MAX_MESSAGE_CONTENT_BYTES
        ) {
          throw new Error('Final Agent memory content is unavailable or exceeds the message limit')
        }
        return projected
      } catch {
        degrade()
        return undefined
      }
    }
  )
  while (cache.size >= MAX_CACHED_AGENT_TURNS) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  cache.set(key, session)
  return session
}
