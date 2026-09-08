import { db } from '@sim/db'
import { memory, memorySecretProvenance } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import { and, eq, sql } from 'drizzle-orm'
import {
  bindDurableSecretProvenanceToValue,
  durableSecretProvenanceFromRegistry,
  importDurableSecretProvenance,
  mergeDurableSecretProvenance,
} from '@/lib/execution/durable-secret-provenance'
import {
  isDurableSecretProvenanceEnforced,
  reportUnrecordedDurableProvenance,
} from '@/lib/execution/durable-secret-provenance-enforcement'
import { redactObjectStrings } from '@/lib/logs/execution/pii-redaction'
import { lockMemoryConversationInTx } from '@/lib/memory/locks'
import {
  createMemorySecretProvenanceSelector,
  readBoundMemorySecretProvenance,
  replaceMemorySecretProvenanceInTx,
} from '@/lib/memory/secret-provenance'
import { getAccurateTokenCount } from '@/lib/tokenization/accurate'
import { MEMORY } from '@/executor/constants'
import type { AgentInputs, Message } from '@/executor/handlers/agent/types'
import type { ExecutionContext } from '@/executor/types'
import {
  projectResolvedSecretModelContent,
  projectResolvedSecretModelJsonStrings,
} from '@/executor/utils/resolved-secret-content-projection'
import { refuseResolvedSecretProjection } from '@/executor/utils/resolved-secret-projection-refusal'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { PROVIDER_DEFINITIONS } from '@/providers/models'

const logger = createLogger('Memory')

const MEMORY_CONTENT_REFUSAL = 'Memory content could not be safely projected'

export class Memory {
  async fetchMemoryMessages(ctx: ExecutionContext, inputs: AgentInputs): Promise<Message[]> {
    if (!inputs.memoryType || inputs.memoryType === 'none') {
      return []
    }

    const workspaceId = this.requireWorkspaceId(ctx)
    this.validateConversationId(inputs.conversationId)

    const stored = await this.fetchMemory(workspaceId, inputs.conversationId!)
    let messages: Message[]

    switch (inputs.memoryType) {
      case 'conversation':
        messages = this.applyContextWindowLimit(stored.messages, inputs.model)
        break

      case 'sliding_window': {
        const limit = this.parsePositiveInt(
          inputs.slidingWindowSize,
          MEMORY.DEFAULT_SLIDING_WINDOW_SIZE
        )
        messages = this.applyWindow(stored.messages, limit)
        break
      }

      case 'sliding_window_tokens': {
        const maxTokens = this.parsePositiveInt(
          inputs.slidingWindowTokens,
          MEMORY.DEFAULT_SLIDING_WINDOW_TOKENS
        )
        messages = this.applyTokenWindow(stored.messages, maxTokens, inputs.model)
        break
      }

      default:
        messages = stored.messages
    }

    const selection = await createMemorySecretProvenanceSelector(
      stored.provenance,
      stored.messages,
      workspaceId
    )
    let includeRecovered = false
    if (selection.recoveredEntryCount > 0 && ctx.resolvedSecretTraceRegistry) {
      const scope = ctx.resolvedSecretTraceRegistry.exportProvenance().scope
      const staged = new ResolvedSecretTraceRegistry([], scope, { staged: true })
      staged.mergeToolCallRegistry(ctx.resolvedSecretTraceRegistry)
      includeRecovered =
        (await importDurableSecretProvenance(
          staged,
          selection.select(messages, true),
          messages,
          'memory'
        )) && staged.getModelEgressSnapshot().complete
      if (includeRecovered) {
        for (const message of messages) {
          const stagedMessage = new ResolvedSecretTraceRegistry([], scope, { staged: true })
          if (
            !(await importDurableSecretProvenance(
              stagedMessage,
              selection.select([message], true),
              message,
              'memory'
            )) ||
            !stagedMessage.getModelEgressSnapshot().complete
          ) {
            includeRecovered = false
            break
          }
        }
      }
      if (includeRecovered) {
        /** Recheck and merge synchronously after the preflight's awaits, including sibling work. */
        const current = new ResolvedSecretTraceRegistry([], scope, { staged: true })
        current.mergeToolCallRegistry(ctx.resolvedSecretTraceRegistry)
        current.mergeToolCallRegistry(staged)
        includeRecovered = current.getModelEgressSnapshot().complete
        if (includeRecovered) ctx.resolvedSecretTraceRegistry.mergeToolCallRegistry(staged)
      }
    }
    if (selection.recoveredEntryCount > 0 && !includeRecovered) {
      logger.error('Historical memory secret provenance recovery was skipped', {
        surface: 'memory',
        cause: ctx.resolvedSecretTraceRegistry
          ? 'legacy-recovery-capacity-exceeded'
          : 'legacy-recovery-context-unavailable',
        entryCount: selection.recoveredEntryCount,
        workspaceId,
      })
    }
    const selectProvenance = (values: readonly unknown[]) =>
      selection.select(values, includeRecovered)
    const selectedProvenance = selectProvenance(messages)
    /**
     * Unrecorded provenance is checked through the same policy the shared import uses, so stored
     * memory written by a run that could not vouch does not permanently refuse every later turn.
     */
    let refuseStoredProvenance: boolean
    if (selectedProvenance.status === 'unknown') {
      refuseStoredProvenance = isDurableSecretProvenanceEnforced('memory')
      if (!refuseStoredProvenance) {
        reportUnrecordedDurableProvenance({
          surface: 'memory',
          cause: 'stored-memory-provenance-unknown',
          ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
        })
      }
    } else {
      refuseStoredProvenance =
        (selectedProvenance.entries.length > 0 && !ctx.resolvedSecretTraceRegistry) ||
        (ctx.resolvedSecretTraceRegistry !== undefined &&
          !(await importDurableSecretProvenance(
            ctx.resolvedSecretTraceRegistry,
            selectedProvenance,
            messages,
            'memory'
          )))
    }
    if (refuseStoredProvenance) {
      refuseResolvedSecretProjection({
        site: 'memory.storedProvenanceImport',
        message: MEMORY_CONTENT_REFUSAL,
        registry: ctx.resolvedSecretTraceRegistry,
        inputPath: 'messages',
      })
    }

    return Promise.all(
      messages.map(async (message) => {
        const messageProvenance = selectProvenance([message])
        const modelRegistry = new ResolvedSecretTraceRegistry(
          [],
          ctx.resolvedSecretTraceRegistry?.exportProvenance().scope
        )
        if (
          !(await importDurableSecretProvenance(
            modelRegistry,
            messageProvenance,
            message,
            'memory'
          ))
        ) {
          refuseResolvedSecretProjection({
            site: 'memory.messageProvenanceImport',
            message: MEMORY_CONTENT_REFUSAL,
            registry: modelRegistry,
            inputPath: 'messages',
          })
        }
        return this.projectMessageForModel(modelRegistry, message)
      })
    )
  }

  private captureMessagesProvenance(
    registry: ResolvedSecretTraceRegistry,
    messages: readonly Message[]
  ): ReturnType<typeof durableSecretProvenanceFromRegistry> {
    return mergeDurableSecretProvenance(
      ...messages.map((message) =>
        bindDurableSecretProvenanceToValue(
          durableSecretProvenanceFromRegistry(registry, message),
          message
        )
      )
    )
  }

  async appendToMemory(
    ctx: ExecutionContext,
    inputs: AgentInputs,
    message: Message
  ): Promise<void> {
    if (!inputs.memoryType || inputs.memoryType === 'none') {
      return
    }

    const workspaceId = this.requireWorkspaceId(ctx)
    this.validateConversationId(inputs.conversationId)

    message = this.sanitizeMessageForStorage(await this.maskContentForStorage(ctx, message))

    this.validateContent(message.content)

    const key = inputs.conversationId!
    const provenance = ctx.resolvedSecretTraceRegistry
      ? this.captureMessagesProvenance(ctx.resolvedSecretTraceRegistry, [message])
      : undefined

    await this.appendMessage(workspaceId, key, message, provenance)

    logger.debug('Appended message to memory', {
      workspaceId,
      role: message.role,
    })
  }

  async seedMemory(ctx: ExecutionContext, inputs: AgentInputs, messages: Message[]): Promise<void> {
    if (!inputs.memoryType || inputs.memoryType === 'none') {
      return
    }

    const workspaceId = this.requireWorkspaceId(ctx)

    const conversationMessages = messages.filter((m) => m.role !== 'system')
    if (conversationMessages.length === 0) {
      return
    }

    this.validateConversationId(inputs.conversationId)

    const key = inputs.conversationId!

    let messagesToStore = conversationMessages
    if (inputs.memoryType === 'sliding_window') {
      const limit = this.parsePositiveInt(
        inputs.slidingWindowSize,
        MEMORY.DEFAULT_SLIDING_WINDOW_SIZE
      )
      messagesToStore = this.applyWindow(conversationMessages, limit)
    } else if (inputs.memoryType === 'sliding_window_tokens') {
      const maxTokens = this.parsePositiveInt(
        inputs.slidingWindowTokens,
        MEMORY.DEFAULT_SLIDING_WINDOW_TOKENS
      )
      messagesToStore = this.applyTokenWindow(conversationMessages, maxTokens, inputs.model)
    }

    messagesToStore = await Promise.all(
      messagesToStore.map(async (message) =>
        this.sanitizeMessageForStorage(await this.maskContentForStorage(ctx, message))
      )
    )

    const provenance = ctx.resolvedSecretTraceRegistry
      ? this.captureMessagesProvenance(ctx.resolvedSecretTraceRegistry, messagesToStore)
      : undefined
    await this.seedMemoryRecord(workspaceId, key, messagesToStore, provenance)

    logger.debug('Seeded memory', {
      workspaceId,
      count: messagesToStore.length,
    })
  }

  /**
   * Handlers persist messages to memory before the executor redacts block
   * output, so mask content here too when the block-output stage is enabled —
   * otherwise raw PII is stored in the memory table and read back on later runs.
   * `onFailure: 'throw'` aborts rather than persisting unredacted content.
   */
  private async maskContentForStorage(ctx: ExecutionContext, message: Message): Promise<Message> {
    if (!ctx.piiBlockOutputRedaction?.enabled || !message.content) {
      return message
    }
    return {
      ...message,
      content: await redactObjectStrings(message.content, {
        entityTypes: ctx.piiBlockOutputRedaction.entityTypes,
        language: ctx.piiBlockOutputRedaction.language,
        customPatterns: ctx.piiBlockOutputRedaction.customPatterns,
        onFailure: 'throw',
      }),
    }
  }

  private projectMessageForModel(registry: ResolvedSecretTraceRegistry, message: Message): Message {
    const functionArguments = this.readFunctionCallArguments(
      message.function_call,
      registry,
      'function_call'
    )
    const toolArguments = message.tool_calls?.map((toolCall) => {
      if (!isPlainRecord(toolCall)) {
        refuseResolvedSecretProjection({
          site: 'memory.toolCallShape',
          message: MEMORY_CONTENT_REFUSAL,
          registry,
          inputPath: 'tool_calls',
        })
      }
      return this.readFunctionCallArguments(toolCall.function, registry, 'tool_calls.function')
    })
    const contentProjection = projectResolvedSecretModelContent(message.content, registry)
    const argumentProjection = projectResolvedSecretModelJsonStrings(
      [functionArguments, ...(toolArguments ?? [])],
      registry
    )
    if (
      !contentProjection.safe ||
      typeof contentProjection.value !== 'string' ||
      !argumentProjection.safe ||
      !Array.isArray(argumentProjection.value) ||
      argumentProjection.value.length !== 1 + (toolArguments?.length ?? 0)
    ) {
      refuseResolvedSecretProjection({
        site: 'memory.messageContentProjection',
        message: MEMORY_CONTENT_REFUSAL,
        registry,
        inputPath: 'content,function_call,tool_calls',
      })
    }

    const content = contentProjection.value
    const [projectedFunctionArguments, ...projectedToolArguments] = argumentProjection.value
    if (
      (functionArguments !== undefined && typeof projectedFunctionArguments !== 'string') ||
      (functionArguments === undefined && projectedFunctionArguments !== undefined)
    ) {
      refuseResolvedSecretProjection({
        site: 'memory.functionCallArgumentProjection',
        message: MEMORY_CONTENT_REFUSAL,
        registry,
        inputPath: 'function_call.arguments',
      })
    }
    if (
      (toolArguments !== undefined && projectedToolArguments.length !== toolArguments.length) ||
      (toolArguments === undefined && projectedToolArguments.length !== 0)
    ) {
      refuseResolvedSecretProjection({
        site: 'memory.toolCallArgumentArity',
        message: MEMORY_CONTENT_REFUSAL,
        registry,
        inputPath: 'tool_calls.function.arguments',
      })
    }

    const projectedToolCalls = message.tool_calls?.map((toolCall, index) => {
      const argument = (projectedToolArguments as unknown[])[index]
      const originalFunction = isPlainRecord(toolCall) ? toolCall.function : undefined
      if (originalFunction === undefined || originalFunction === null) return toolCall
      if (!isPlainRecord(originalFunction)) {
        refuseResolvedSecretProjection({
          site: 'memory.toolCallFunctionShape',
          message: MEMORY_CONTENT_REFUSAL,
          registry,
          inputPath: 'tool_calls.function',
        })
      }
      if (!Object.hasOwn(originalFunction, 'arguments')) return toolCall
      if (typeof argument !== 'string') {
        refuseResolvedSecretProjection({
          site: 'memory.toolCallArgumentType',
          message: MEMORY_CONTENT_REFUSAL,
          registry,
          inputPath: 'tool_calls.function.arguments',
        })
      }
      return {
        ...toolCall,
        function: { ...originalFunction, arguments: argument },
      }
    })

    let projectedFunctionCall = message.function_call
    if (isPlainRecord(message.function_call) && Object.hasOwn(message.function_call, 'arguments')) {
      projectedFunctionCall = {
        ...message.function_call,
        arguments: projectedFunctionArguments,
      }
    }

    return {
      ...message,
      content,
      ...(message.function_call !== undefined ? { function_call: projectedFunctionCall } : {}),
      ...(projectedToolCalls !== undefined ? { tool_calls: projectedToolCalls } : {}),
    }
  }

  /**
   * Takes the registry and path from its caller so a refusal here reports the run that failed.
   * Without them the refusal would deduplicate process-wide and name no cause.
   */
  private readFunctionCallArguments(
    functionCall: unknown,
    registry: ResolvedSecretTraceRegistry,
    inputPath: string
  ): string | undefined {
    if (functionCall === undefined || functionCall === null) return undefined
    if (!isPlainRecord(functionCall)) {
      refuseResolvedSecretProjection({
        site: 'memory.functionCallShape',
        message: MEMORY_CONTENT_REFUSAL,
        registry,
        inputPath,
      })
    }
    if (!Object.hasOwn(functionCall, 'arguments')) return undefined
    if (typeof functionCall.arguments !== 'string') {
      refuseResolvedSecretProjection({
        site: 'memory.functionCallArgumentType',
        message: MEMORY_CONTENT_REFUSAL,
        registry,
        inputPath,
      })
    }
    return functionCall.arguments
  }

  private requireWorkspaceId(ctx: ExecutionContext): string {
    if (!ctx.workspaceId) {
      throw new Error('workspaceId is required for memory operations')
    }
    return ctx.workspaceId
  }

  private applyWindow(messages: Message[], limit: number): Message[] {
    return messages.slice(-limit)
  }

  private sanitizeMessageForStorage(message: Message): Message {
    const { files: _files, ...messageWithoutFiles } = message
    return messageWithoutFiles
  }

  private applyTokenWindow(messages: Message[], maxTokens: number, model?: string): Message[] {
    const result: Message[] = []
    let tokenCount = 0

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      const msgTokens = getAccurateTokenCount(msg.content, model)

      if (tokenCount + msgTokens <= maxTokens) {
        result.unshift(msg)
        tokenCount += msgTokens
      } else if (result.length === 0) {
        result.unshift(msg)
        break
      } else {
        break
      }
    }

    return result
  }

  private applyContextWindowLimit(messages: Message[], model?: string): Message[] {
    if (!model) return messages

    for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
      if (provider.contextInformationAvailable === false) continue

      const matchesPattern = provider.modelPatterns?.some((p) => p.test(model))
      const matchesModel = provider.models.some((m) => m.id === model)

      if (matchesPattern || matchesModel) {
        const modelDef = provider.models.find((m) => m.id === model)
        if (modelDef?.contextWindow) {
          const maxTokens = Math.floor(modelDef.contextWindow * MEMORY.CONTEXT_WINDOW_UTILIZATION)
          return this.applyTokenWindow(messages, maxTokens, model)
        }
      }
    }

    return messages
  }

  private async fetchMemory(
    workspaceId: string,
    key: string
  ): Promise<{
    messages: Message[]
    provenance: ReturnType<typeof readBoundMemorySecretProvenance>
  }> {
    const result = await db
      .select({
        data: memory.data,
        secretProvenanceVersion: memory.secretProvenanceVersion,
        provenanceContentHash: memorySecretProvenance.contentHash,
        provenanceStatus: memorySecretProvenance.status,
        provenanceEntries: memorySecretProvenance.entries,
      })
      .from(memory)
      .leftJoin(memorySecretProvenance, eq(memorySecretProvenance.memoryId, memory.id))
      .where(and(eq(memory.workspaceId, workspaceId), eq(memory.key, key)))
      .limit(1)

    if (result.length === 0) {
      return { messages: [], provenance: { status: 'exact', entries: [] } }
    }

    const data = result[0].data
    const provenance = readBoundMemorySecretProvenance({
      secretProvenanceVersion: result[0].secretProvenanceVersion,
      data,
      provenanceContentHash: result[0].provenanceContentHash,
      status: result[0].provenanceStatus,
      entries: result[0].provenanceEntries,
    })
    const messages = (Array.isArray(data) ? data : [])
      .filter(
        (msg): msg is Message =>
          msg &&
          typeof msg === 'object' &&
          'role' in msg &&
          'content' in msg &&
          ['system', 'user', 'assistant'].includes(msg.role) &&
          typeof msg.content === 'string'
      )
      .map((msg) => this.sanitizeMessageForStorage(msg))
    return { messages, provenance }
  }

  private async seedMemoryRecord(
    workspaceId: string,
    key: string,
    messages: Message[],
    provenance: ReturnType<typeof durableSecretProvenanceFromRegistry> | undefined
  ): Promise<void> {
    const now = new Date()

    const sanitizedMessages = messages.map((message) => this.sanitizeMessageForStorage(message))

    await db.transaction(async (tx) => {
      await lockMemoryConversationInTx(tx, workspaceId, key)
      const id = generateId()
      const [inserted] = await tx
        .insert(memory)
        .values({
          id,
          workspaceId,
          key,
          data: sanitizedMessages,
          secretProvenanceVersion: provenance ? 1 : null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: memory.id })
      if (inserted && provenance) {
        await replaceMemorySecretProvenanceInTx(tx, id, sanitizedMessages, provenance)
      }
    })
  }

  private async appendMessage(
    workspaceId: string,
    key: string,
    message: Message,
    messageProvenance: ReturnType<typeof durableSecretProvenanceFromRegistry> | undefined
  ): Promise<void> {
    const now = new Date()

    const sanitizedMessage = this.sanitizeMessageForStorage(message)

    await db.transaction(async (tx) => {
      await lockMemoryConversationInTx(tx, workspaceId, key)
      const [existing] = await tx
        .select({
          id: memory.id,
          data: memory.data,
          updatedAt: memory.updatedAt,
          secretProvenanceVersion: memory.secretProvenanceVersion,
        })
        .from(memory)
        .where(and(eq(memory.workspaceId, workspaceId), eq(memory.key, key)))
        .limit(1)
        .for('update')

      if (!existing) {
        const id = generateId()
        await tx.insert(memory).values({
          id,
          workspaceId,
          key,
          data: [sanitizedMessage],
          secretProvenanceVersion: messageProvenance ? 1 : null,
          createdAt: now,
          updatedAt: now,
        })
        if (messageProvenance) {
          await replaceMemorySecretProvenanceInTx(tx, id, [sanitizedMessage], messageProvenance)
        }
        return
      }

      const [sidecar] = await tx
        .select()
        .from(memorySecretProvenance)
        .where(eq(memorySecretProvenance.memoryId, existing.id))
        .limit(1)
      const previousProvenance = readBoundMemorySecretProvenance({
        secretProvenanceVersion: existing.secretProvenanceVersion,
        data: existing.data,
        provenanceContentHash: sidecar?.contentHash ?? null,
        status: sidecar?.status ?? null,
        entries: sidecar?.entries,
      })
      const previousData = Array.isArray(existing.data) ? existing.data : []
      const nextData = [...previousData, sanitizedMessage]
      await tx
        .update(memory)
        .set({
          data: sql`${memory.data} || ${JSON.stringify([sanitizedMessage])}::jsonb`,
          secretProvenanceVersion: messageProvenance ? 1 : existing.secretProvenanceVersion,
          updatedAt: now,
        })
        .where(eq(memory.id, existing.id))
      if (messageProvenance) {
        const nextProvenance = mergeDurableSecretProvenance(previousProvenance, messageProvenance)
        await replaceMemorySecretProvenanceInTx(
          tx,
          existing.id,
          nextData,
          nextProvenance,
          previousProvenance.status === 'unknown'
            ? 'inherited-provenance-unknown'
            : messageProvenance.status === 'exact' && nextProvenance.status === 'unknown'
              ? 'merge-provenance-limit'
              : undefined
        )
      }
    })
  }

  private parsePositiveInt(value: string | undefined, defaultValue: number): number {
    if (!value) return defaultValue
    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed) || parsed <= 0) return defaultValue
    return parsed
  }

  private validateConversationId(conversationId?: string): void {
    if (!conversationId || conversationId.trim() === '') {
      throw new Error('Conversation ID is required')
    }
    if (conversationId.length > MEMORY.MAX_CONVERSATION_ID_LENGTH) {
      throw new Error(
        `Conversation ID too long (max ${MEMORY.MAX_CONVERSATION_ID_LENGTH} characters)`
      )
    }
  }

  private validateContent(content: string): void {
    const size = Buffer.byteLength(content, 'utf8')
    if (size > MEMORY.MAX_MESSAGE_CONTENT_BYTES) {
      throw new Error(
        `Message content too large (${size} bytes, max ${MEMORY.MAX_MESSAGE_CONTENT_BYTES})`
      )
    }
  }
}

export const memoryService = new Memory()
