import { db } from '@sim/db'
import { memory, memorySecretProvenance } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import { and, eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import {
  bindDurableSecretProvenanceToValue,
  type DurableSecretProvenance,
  durableSecretProvenanceFromRegistry,
  filterDurableSecretProvenanceBySourceValues,
  importDurableSecretProvenance,
  mergeDurableSecretProvenance,
} from '@/lib/execution/durable-secret-provenance'
import { mergeFileKeys } from '@/lib/execution/payloads/access-keys'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import { redactObjectStrings } from '@/lib/logs/execution/pii-redaction'
import {
  appendAgentMemoryMessageUseCase,
  readAgentMemoryItemsUseCase,
  readAgentMemoryPrefixUseCase,
} from '@/lib/memory/application/agent-turns'
import { MEMORY_DELEGATION_AUDIENCE } from '@/lib/memory/application/authorization'
import { MEMORY } from '@/lib/memory/constants'
import {
  appendMemoryMessages,
  readPlainMemoryTail,
  seedMemoryMessages,
} from '@/lib/memory/conversation-store'
import {
  markConversationExchangeGroup,
  selectConversationContextWindow,
  selectConversationMessageWindow,
  selectConversationTokenWindow,
} from '@/lib/memory/history-window'
import {
  bindMemorySecretProvenanceToMessages,
  createMemorySecretProvenanceSelector,
  readBoundMemorySecretProvenance,
} from '@/lib/memory/secret-provenance'
import type { AgentInputs, FileNameProjection, Message } from '@/executor/handlers/agent/types'
import type { ExecutionContext } from '@/executor/types'
import {
  projectResolvedSecretModelContent,
  projectResolvedSecretModelJsonStrings,
} from '@/executor/utils/resolved-secret-content-projection'
import { refuseResolvedSecretProjection } from '@/executor/utils/resolved-secret-projection-refusal'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import {
  copyNativeConversationMessage,
  setEncryptedConversationMessage,
} from '@/providers/conversation-metadata'

const logger = createLogger('Memory')

const MEMORY_CONTENT_REFUSAL = 'Memory content could not be safely projected'
const MAX_RICH_HISTORY_BYTES = 4 * 1024 * 1024
const MAX_RICH_HISTORY_ITEMS = 1000

export interface MemoryHistoryOptions {
  richHistory?: boolean
  memoryId?: string
  excludeTurnId?: string
}

export interface MemoryAppendOptions {
  memoryId: string
  turnId: string
  appendKey: string
}

const messageTurns = new WeakMap<object, string>()
const messageAppendKeys = new WeakMap<object, string>()

/** Internal invocation identity is never serialized into a provider or Memory API message. */
export function getMemoryMessageTurnId(message: object): string | undefined {
  return messageTurns.get(message)
}

/** Identifies the original input slot without adding internal metadata to public message data. */
export function getMemoryMessageAppendKey(message: object): string | undefined {
  return messageAppendKeys.get(message)
}

function copyMemoryMessageMetadata(source: Message, target: Message): void {
  copyNativeConversationMessage(source, target)
  const turnId = messageTurns.get(source)
  if (turnId) messageTurns.set(target, turnId)
  const appendKey = messageAppendKeys.get(source)
  if (appendKey) messageAppendKeys.set(target, appendKey)
}

/** Only storage availability/conflict failures degrade; identity and projection failures propagate. */
function isOptionalMemoryStorageFailure(error: unknown): boolean {
  if (error instanceof OrchestrationError)
    return error.code === 'not_found' || error.code === 'conflict' || error.code === 'internal'
  const code = getPostgresErrorCode(error)
  return Boolean(
    (code &&
      (/^[0-9A-Z]{5}$/.test(code) ||
        [
          'ECONNREFUSED',
          'ECONNRESET',
          'EPIPE',
          'ETIMEDOUT',
          'ENOTFOUND',
          'CONNECTION_CLOSED',
          'CONNECTION_ENDED',
          'CONNECT_TIMEOUT',
        ].includes(code))) ||
      (error instanceof Error &&
        (error.name === 'DrizzleQueryError' || error.name === 'PostgresError'))
  )
}

export class Memory {
  async fetchMemoryMessages(
    ctx: ExecutionContext,
    inputs: AgentInputs,
    projectedNameByFile?: WeakMap<object, FileNameProjection>,
    options: MemoryHistoryOptions = {}
  ): Promise<Message[]> {
    if (!inputs.memoryType || inputs.memoryType === 'none') {
      return []
    }

    const workspaceId = this.requireWorkspaceId(ctx)
    this.validateConversationId(inputs.conversationId)

    let stored: Awaited<ReturnType<Memory['fetchMemory']>>
    try {
      stored = await this.fetchMemory(ctx, workspaceId, inputs.conversationId!, options)
    } catch (error) {
      if (!options.richHistory || !isOptionalMemoryStorageFailure(error)) throw error
      logger.warn('Agent durable memory read is unavailable', { workspaceId })
      return []
    }
    let messages: Message[]

    switch (inputs.memoryType) {
      case 'conversation':
        messages = options.richHistory
          ? stored.messages
          : selectConversationContextWindow(stored.messages, inputs.model, stored.groups)
        break

      case 'sliding_window': {
        const limit = this.parsePositiveInt(
          inputs.slidingWindowSize,
          MEMORY.DEFAULT_SLIDING_WINDOW_SIZE
        )
        messages = selectConversationMessageWindow(stored.messages, limit, stored.groups)
        break
      }

      case 'sliding_window_tokens': {
        const maxTokens = this.parsePositiveInt(
          inputs.slidingWindowTokens,
          MEMORY.DEFAULT_SLIDING_WINDOW_TOKENS
        )
        messages = selectConversationTokenWindow(
          stored.messages,
          maxTokens,
          inputs.model,
          stored.groups
        )
        break
      }

      default:
        messages = stored.messages
    }

    /** Bound historical downloads independently of text-token windows and per-file byte caps. */
    const fileCount = messages.reduce((count, message) => count + (message.files?.length ?? 0), 0)
    if (fileCount > MEMORY.MAX_REPLAY_FILE_REFERENCES) {
      throw new Error(
        `Conversation memory exceeds ${MEMORY.MAX_REPLAY_FILE_REFERENCES} file attachments. Use a smaller memory window.`
      )
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
        (await importDurableSecretProvenance(staged, selection.select(messages, true), messages)) &&
        staged.getModelEgressSnapshot().complete
      if (includeRecovered) {
        for (const message of messages) {
          const stagedMessage = new ResolvedSecretTraceRegistry([], scope, { staged: true })
          if (
            !(await importDurableSecretProvenance(
              stagedMessage,
              selection.select([message], true),
              message
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
    const selectProvenance = (values: readonly Message[]) =>
      mergeDurableSecretProvenance(
        selection.select(values, includeRecovered),
        ...values.flatMap((message) => {
          const provenance = stored.provenanceByMessage?.get(message)
          return provenance
            ? [filterDurableSecretProvenanceBySourceValues(provenance, [message])]
            : []
        })
      )
    const selectedProvenance = selectProvenance(messages)
    const refuseStoredProvenance =
      selectedProvenance.status === 'unknown' ||
      (selectedProvenance.entries.length > 0 && !ctx.resolvedSecretTraceRegistry) ||
      (ctx.resolvedSecretTraceRegistry !== undefined &&
        !(await importDurableSecretProvenance(
          ctx.resolvedSecretTraceRegistry,
          selectedProvenance,
          messages
        )))
    if (refuseStoredProvenance) {
      refuseResolvedSecretProjection({
        site: 'memory.storedProvenanceImport',
        message: MEMORY_CONTENT_REFUSAL,
        registry: ctx.resolvedSecretTraceRegistry,
        inputPath: 'messages',
      })
    }

    const projectedMessages = await Promise.all(
      messages.map(async (message) => {
        const messageProvenance = selectProvenance([message])
        const modelRegistry = new ResolvedSecretTraceRegistry(
          [],
          ctx.resolvedSecretTraceRegistry?.exportProvenance().scope
        )
        if (!(await importDurableSecretProvenance(modelRegistry, messageProvenance, message))) {
          refuseResolvedSecretProjection({
            site: 'memory.messageProvenanceImport',
            message: MEMORY_CONTENT_REFUSAL,
            registry: modelRegistry,
            inputPath: 'messages',
          })
        }
        return this.projectMessageForModel(modelRegistry, message, projectedNameByFile)
      })
    )
    /** Saved references admit only these files; materialization still enforces their scope. */
    mergeFileKeys(
      ctx,
      projectedMessages.flatMap((message) => message.files?.map((file) => file.key) ?? [])
    )
    return projectedMessages
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
    message: Message,
    options?: MemoryAppendOptions
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

    if (options) {
      try {
        const principal = await createExecutorPrincipalFromExecutionContext({
          context: ctx,
          audience: MEMORY_DELEGATION_AUDIENCE,
        })
        await appendAgentMemoryMessageUseCase.execute({
          principal,
          input: { ...options, workspaceId, conversationId: key, data: message, provenance },
        })
      } catch (error) {
        if (!isOptionalMemoryStorageFailure(error)) throw error
        logger.warn('Agent durable memory append is unavailable', { workspaceId })
        return
      }
    } else await appendMemoryMessages({ workspaceId, key, messages: [message], provenance })

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
      messagesToStore = selectConversationMessageWindow(conversationMessages, limit)
    } else if (inputs.memoryType === 'sliding_window_tokens') {
      const maxTokens = this.parsePositiveInt(
        inputs.slidingWindowTokens,
        MEMORY.DEFAULT_SLIDING_WINDOW_TOKENS
      )
      messagesToStore = selectConversationTokenWindow(conversationMessages, maxTokens, inputs.model)
    }

    messagesToStore = await Promise.all(
      messagesToStore.map(async (message) =>
        this.sanitizeMessageForStorage(await this.maskContentForStorage(ctx, message))
      )
    )

    const provenance = ctx.resolvedSecretTraceRegistry
      ? this.captureMessagesProvenance(ctx.resolvedSecretTraceRegistry, messagesToStore)
      : undefined
    await seedMemoryMessages({ workspaceId, key, messages: messagesToStore, provenance })

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

  private projectMessageForModel(
    registry: ResolvedSecretTraceRegistry,
    message: Message,
    projectedNameByFile?: WeakMap<object, FileNameProjection>
  ): Message {
    for (const file of message.files ?? []) {
      const projection = projectResolvedSecretModelContent(file.name, registry)
      if (!projection.safe || typeof projection.value !== 'string') {
        refuseResolvedSecretProjection({
          site: 'memory.fileNameProjection',
          message: MEMORY_CONTENT_REFUSAL,
          registry,
          inputPath: 'files.name',
        })
      }
      if (projection.value !== file.name) {
        projectedNameByFile?.set(file, { name: projection.value })
      }
    }
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
      (typeof contentProjection.value !== 'string' && contentProjection.value !== null) ||
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

    const projected = {
      ...message,
      content,
      ...(message.function_call !== undefined ? { function_call: projectedFunctionCall } : {}),
      ...(projectedToolCalls !== undefined ? { tool_calls: projectedToolCalls } : {}),
    }
    copyMemoryMessageMetadata(message, projected)
    return projected
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

  /** Storage keys survive turns; inline bytes, signed URLs, and provider handles do not. */
  private sanitizeMessageForStorage(message: Message): Message {
    const { files: _files, ...messageWithoutFiles } = message
    const files = Array.isArray(message.files)
      ? message.files
          .filter(isUserFileWithMetadata)
          .filter((file) => file.key)
          .map((file) => ({
            id: file.id,
            name: file.name,
            key: file.key,
            url: '',
            size: file.size,
            type: file.type,
            ...(typeof file.context === 'string' ? { context: file.context } : {}),
          }))
      : []
    const sanitized = files.length > 0 ? { ...messageWithoutFiles, files } : messageWithoutFiles
    copyMemoryMessageMetadata(message, sanitized)
    return sanitized
  }

  private async fetchMemory(
    ctx: ExecutionContext,
    workspaceId: string,
    key: string,
    options: MemoryHistoryOptions
  ): Promise<{
    messages: Message[]
    groups?: Message[][]
    provenanceByMessage?: Map<Message, DurableSecretProvenance>
    provenance: ReturnType<typeof readBoundMemorySecretProvenance>
  }> {
    const result = options.richHistory
      ? [
          await readAgentMemoryPrefixUseCase.execute({
            principal: await createExecutorPrincipalFromExecutionContext({
              context: ctx,
              audience: MEMORY_DELEGATION_AUDIENCE,
            }),
            input: { workspaceId, conversationId: key, memoryId: options.memoryId },
          }),
        ]
      : await db
          .select({
            id: memory.id,
            storageVersion: memory.storageVersion,
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

    const row = result[0]
    if (!row || (options.memoryId && row.id !== options.memoryId)) {
      return { messages: [], provenance: { status: 'exact', entries: [] } }
    }

    let data = row.data
    let provenance = readBoundMemorySecretProvenance({
      secretProvenanceVersion: row.secretProvenanceVersion,
      data,
      provenanceContentHash: row.provenanceContentHash,
      status: row.provenanceStatus,
      entries: row.provenanceEntries,
    })
    if (row.storageVersion === 2 && !options.richHistory) {
      const tail = await readPlainMemoryTail(row.id, workspaceId)
      data = [...(Array.isArray(data) ? data : []), ...tail.messages]
      provenance = mergeDurableSecretProvenance(provenance, tail.provenance)
    }
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
    if (row.storageVersion === 2 && options.richHistory) {
      try {
        const tail = await this.fetchRichTail(ctx, row.id, workspaceId, options)
        const groups = [...messages.map((message) => [message]), ...tail.groups]
        return {
          messages: groups.flat(),
          groups,
          provenance,
          provenanceByMessage: tail.provenanceByMessage,
        }
      } catch (error) {
        if (!isOptionalMemoryStorageFailure(error)) throw error
        logger.warn('Agent durable memory history is unavailable', { workspaceId })
      }
    }
    return { messages, provenance }
  }

  private async fetchRichTail(
    ctx: ExecutionContext,
    memoryId: string,
    workspaceId: string,
    options: MemoryHistoryOptions
  ): Promise<{ groups: Message[][]; provenanceByMessage: Map<Message, DurableSecretProvenance> }> {
    const newest: Array<{ messages: Message[]; provenance: DurableSecretProvenance }> = []
    let bytes = 0
    let scannedItems = 0
    let beforeSequence: number | undefined
    let complete = false
    const principal = await createExecutorPrincipalFromExecutionContext({
      context: ctx,
      audience: MEMORY_DELEGATION_AUDIENCE,
    })
    while (!complete) {
      const page = await readAgentMemoryItemsUseCase.execute({
        principal,
        input: { memoryId, workspaceId, beforeSequence, limit: 10 },
      })
      for (const item of page.items) {
        if (++scannedItems > MAX_RICH_HISTORY_ITEMS) {
          complete = true
          break
        }
        let values: unknown[]
        let encryptedNative: string | undefined
        if (item.kind === 'message') values = [item.data]
        else {
          if (
            !isPlainRecord(item.data) ||
            item.data.version !== 1 ||
            !Array.isArray(item.data.messages)
          )
            continue
          if (options.excludeTurnId && item.turnId === options.excludeTurnId) continue
          values = item.data.messages
          encryptedNative =
            typeof item.data.encryptedNative === 'string' ? item.data.encryptedNative : undefined
        }
        const valid = values.every(
          (value) =>
            isPlainRecord(value) &&
            ['system', 'user', 'assistant', 'tool', 'function'].includes(String(value.role)) &&
            (typeof value.content === 'string' ||
              (value.role === 'assistant' &&
                value.content === null &&
                Array.isArray(value.tool_calls)))
        )
        if (!valid || values.length === 0) continue
        const group = values as Message[]
        const groupBytes =
          Buffer.byteLength(JSON.stringify(item.data), 'utf8') +
          Buffer.byteLength(JSON.stringify(item.provenance), 'utf8')
        if (bytes + groupBytes > MAX_RICH_HISTORY_BYTES) {
          complete = true
          break
        }
        bytes += groupBytes
        const sanitized = group.map((message) => this.sanitizeMessageForStorage(message))
        if (item.kind === 'exchange') markConversationExchangeGroup(sanitized)
        for (const message of sanitized) {
          if (item.turnId) messageTurns.set(message, item.turnId)
          messageAppendKeys.set(message, item.appendKey)
        }
        if (encryptedNative && sanitized[0]?.role === 'assistant')
          setEncryptedConversationMessage(sanitized[0], encryptedNative)
        newest.push({
          messages: sanitized,
          provenance: await bindMemorySecretProvenanceToMessages(sanitized, item.provenance),
        })
      }
      if (!page.nextBeforeSequence || scannedItems >= MAX_RICH_HISTORY_ITEMS) break
      beforeSequence = page.nextBeforeSequence
    }
    newest.reverse()
    return {
      groups: newest.map((group) => group.messages),
      provenanceByMessage: new Map(
        newest.flatMap((group) =>
          group.messages.map((message) => [message, group.provenance] as const)
        )
      ),
    }
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

  private validateContent(content: string | null): void {
    if (content === null) return
    const size = Buffer.byteLength(content, 'utf8')
    if (size > MEMORY.MAX_MESSAGE_CONTENT_BYTES) {
      throw new Error(
        `Message content too large (${size} bytes, max ${MEMORY.MAX_MESSAGE_CONTENT_BYTES})`
      )
    }
  }
}

export const memoryService = new Memory()
