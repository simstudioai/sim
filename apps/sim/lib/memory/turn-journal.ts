import { isRecordLike } from '@sim/utils/object'
import { EXACT_EMPTY_DURABLE_SECRET_PROVENANCE } from '@/lib/execution/durable-secret-provenance'
import { isLargeValueRef, type LargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { projectableMemoryCheckpoint, restoreMemoryCheckpoint } from '@/lib/memory/checkpoint-codec'
import type { AgentTurnState, ConversationToolResult } from '@/lib/memory/conversation-types'

const MAX_JOURNAL_STEPS = 1000
const MAX_JOURNAL_RESULTS = 10_000
/** Includes encoded native bytes and compact results, excluding separately offloaded raw results. */
export const MAX_AGENT_JOURNAL_PAYLOAD_BYTES = 32 * 1024 * 1024

interface JournalPayloadReference {
  ref: LargeValueRef
  bytes: number
}

interface JournalResult extends JournalPayloadReference {
  source?: 'tool-result'
  invocationId: string
  rawSuccess: boolean
  modelSuccess: boolean
  toolCost: number
}

interface JournalStep extends JournalPayloadReference {
  id: string
  results: JournalResult[]
}

/** Only this manifest controls invocation progress; artifacts are immutable payloads. */
export interface AgentTurnJournalState {
  version: 2
  steps: JournalStep[]
  contextUsage?: AgentTurnState['contextUsage']
  final?: JournalPayloadReference
}

export interface AgentTurnJournalBinding {
  identity: string
  memoryId: string
  turnId: string
}

interface JournalStorage {
  store(value: unknown): Promise<LargeValueRef | undefined>
  read(ref: LargeValueRef): Promise<unknown>
  compactResult(result: ConversationToolResult, ref: LargeValueRef): ConversationToolResult
  unavailable(): void
}

function validReference(value: unknown): value is JournalPayloadReference {
  return (
    isRecordLike(value) &&
    isLargeValueRef(value.ref) &&
    Boolean(value.ref.key) &&
    typeof value.bytes === 'number' &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    value.bytes <= MAX_AGENT_JOURNAL_PAYLOAD_BYTES
  )
}

function validJournal(value: unknown): value is AgentTurnJournalState {
  if (
    !isRecordLike(value) ||
    value.version !== 2 ||
    !Array.isArray(value.steps) ||
    value.steps.length > MAX_JOURNAL_STEPS ||
    (value.final !== undefined && !validReference(value.final))
  )
    return false
  const stepIds = new Set<string>()
  const resultIds = new Set<string>()
  let bytes = value.final?.bytes ?? 0
  for (const step of value.steps) {
    if (
      !validReference(step) ||
      !('id' in step) ||
      typeof step.id !== 'string' ||
      !step.id ||
      stepIds.has(step.id) ||
      !('results' in step) ||
      !Array.isArray(step.results) ||
      step.results.length > 1000
    )
      return false
    stepIds.add(step.id)
    bytes += step.bytes
    for (const result of step.results) {
      if (
        !isRecordLike(result) ||
        !validReference(result) ||
        typeof result.invocationId !== 'string' ||
        !result.invocationId ||
        resultIds.has(result.invocationId) ||
        (result.source !== undefined && result.source !== 'tool-result') ||
        typeof result.rawSuccess !== 'boolean' ||
        typeof result.modelSuccess !== 'boolean' ||
        typeof result.toolCost !== 'number' ||
        !Number.isFinite(result.toolCost) ||
        result.toolCost < 0
      )
        return false
      resultIds.add(result.invocationId)
      bytes += result.bytes
    }
    if (resultIds.size > MAX_JOURNAL_RESULTS || bytes > MAX_AGENT_JOURNAL_PAYLOAD_BYTES)
      return false
  }
  return bytes <= MAX_AGENT_JOURNAL_PAYLOAD_BYTES
}

function unavailableResult(result: JournalResult): ConversationToolResult {
  const output = {
    memoryResultUnavailable: true,
    notice: 'This tool already executed. Its recorded details are unavailable for replay.',
  }
  return {
    invocationId: result.invocationId,
    provenance: EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
    rawResponse: {
      success: result.rawSuccess,
      output: { ...output, ...(result.toolCost ? { cost: { total: result.toolCost } } : {}) },
      ...(!result.rawSuccess ? { error: 'Recorded tool execution failed.' } : {}),
    },
    modelResponse: {
      success: result.modelSuccess,
      output,
      ...(!result.modelSuccess ? { error: 'Recorded tool execution failed.' } : {}),
    },
  }
}

/** Stores each step/result once while retaining the existing memory-owned artifact lifecycle. */
export class AgentTurnJournal {
  private journal: AgentTurnJournalState = { version: 2, steps: [] }
  private payloadBytes = 0

  constructor(
    private readonly binding: AgentTurnJournalBinding,
    private readonly storage: JournalStorage
  ) {}

  private async store(
    part: 'step' | 'result' | 'final',
    id: string,
    value: unknown
  ): Promise<JournalPayloadReference> {
    const payload = projectableMemoryCheckpoint(value)
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
    if (this.payloadBytes + bytes > MAX_AGENT_JOURNAL_PAYLOAD_BYTES)
      throw new Error('Agent memory journal exceeds its payload budget')
    const ref = await this.storage.store({
      version: 1,
      kind: 'agent-turn-journal-payload',
      ...this.binding,
      part,
      id,
      payload,
    })
    if (!ref) throw new Error('Agent memory journal payload storage unavailable')
    this.payloadBytes += bytes
    return { ref, bytes }
  }

  private async read(
    part: 'step' | 'result' | 'final',
    id: string,
    reference: JournalPayloadReference
  ): Promise<unknown> {
    const value = await this.storage.read(reference.ref)
    if (
      !isRecordLike(value) ||
      value.version !== 1 ||
      value.kind !== 'agent-turn-journal-payload' ||
      value.identity !== this.binding.identity ||
      value.memoryId !== this.binding.memoryId ||
      value.turnId !== this.binding.turnId ||
      value.part !== part ||
      value.id !== id ||
      Buffer.byteLength(JSON.stringify(value.payload), 'utf8') !== reference.bytes
    )
      throw new Error('Agent memory journal payload binding is invalid')
    return restoreMemoryCheckpoint(value.payload)
  }

  async restore(value: unknown): Promise<unknown> {
    if (!validJournal(value)) throw new Error('Invalid Agent memory journal')
    this.journal = structuredClone(value)
    const steps: unknown[] = []
    for (const step of this.journal.steps) {
      const payload = await this.read('step', step.id, step)
      if (!isRecordLike(payload) || payload.id !== step.id || 'results' in payload)
        throw new Error('Invalid Agent memory journal step')
      this.payloadBytes += step.bytes
      const results: unknown[] = []
      for (const result of step.results) {
        try {
          const restored =
            result.source === 'tool-result'
              ? await this.storage.read(result.ref)
              : await this.read('result', result.invocationId, result)
          if (!isRecordLike(restored) || restored.invocationId !== result.invocationId)
            throw new Error('Invalid Agent memory journal result')
          if (result.source === 'tool-result') {
            if (
              !isRecordLike(restored.rawResponse) ||
              typeof restored.rawResponse.success !== 'boolean' ||
              !isRecordLike(restored.rawResponse.output) ||
              !isRecordLike(restored.modelResponse) ||
              typeof restored.modelResponse.success !== 'boolean' ||
              !isRecordLike(restored.modelResponse.output)
            )
              throw new Error('Invalid Agent memory result artifact')
            const compact = this.storage.compactResult(
              {
                invocationId: result.invocationId,
                rawResponse: {
                  ...restored.rawResponse,
                  success: restored.rawResponse.success,
                  output: restored.rawResponse.output,
                },
                modelResponse: {
                  ...restored.modelResponse,
                  success: restored.modelResponse.success,
                  output: restored.modelResponse.output,
                },
              },
              result.ref
            )
            const recorded = { ...restored, ...compact, provenance: restored.provenance }
            if (
              Buffer.byteLength(JSON.stringify(projectableMemoryCheckpoint(recorded)), 'utf8') >
              result.bytes
            )
              throw new Error('Agent memory result exceeds its retained payload budget')
            results.push(recorded)
          } else {
            results.push(restored)
          }
        } catch {
          this.storage.unavailable()
          results.push(unavailableResult(result))
        }
        this.payloadBytes += result.bytes
      }
      steps.push({ ...payload, results })
    }
    const final = this.journal.final
      ? await this.read('final', 'final', this.journal.final)
      : undefined
    this.payloadBytes += this.journal.final?.bytes ?? 0
    return {
      version: 1,
      steps,
      contextUsage: this.journal.contextUsage,
      ...(final ? { final } : {}),
    }
  }

  async checkpoint(state: AgentTurnState): Promise<AgentTurnJournalState> {
    if (state.steps.length > MAX_JOURNAL_STEPS)
      throw new Error('Agent memory journal exceeds its step limit')
    let resultCount = 0
    for (const [index, step] of state.steps.entries()) {
      resultCount += step.results.length
      if (resultCount > MAX_JOURNAL_RESULTS || step.calls.length > 1000)
        throw new Error('Agent memory journal exceeds its invocation limit')
      let entry = this.journal.steps[index]
      if (!entry) {
        const { results: _results, ...payload } = step
        entry = { id: step.id, ...(await this.store('step', step.id, payload)), results: [] }
        this.journal.steps.push(entry)
      }
      if (entry.id !== step.id) throw new Error('Agent memory journal step order changed')
      for (const result of step.results.slice(entry.results.length)) {
        const cost = result.rawResponse.output.cost
        const toolCost =
          isRecordLike(cost) &&
          typeof cost.total === 'number' &&
          Number.isFinite(cost.total) &&
          cost.total > 0
            ? cost.total
            : 0
        const reference = result.artifact
          ? {
              ref: result.artifact,
              bytes: Buffer.byteLength(JSON.stringify(projectableMemoryCheckpoint(result)), 'utf8'),
            }
          : await this.store('result', result.invocationId, result)
        if (result.artifact) {
          this.payloadBytes += reference.bytes
          if (this.payloadBytes > MAX_AGENT_JOURNAL_PAYLOAD_BYTES)
            throw new Error('Agent memory journal exceeds its payload budget')
        }
        entry.results.push({
          ...(result.artifact ? { source: 'tool-result' as const } : {}),
          invocationId: result.invocationId,
          rawSuccess: result.rawResponse.success,
          modelSuccess: result.modelResponse.success,
          toolCost,
          ...reference,
        })
      }
    }
    if (state.final && !this.journal.final)
      this.journal.final = await this.store('final', 'final', state.final)
    this.journal.contextUsage = state.contextUsage
    return structuredClone(this.journal)
  }
}
