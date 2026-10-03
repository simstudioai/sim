import { isRecordLike } from '@sim/utils/object'
import type { LargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { decryptMemoryCheckpoint, restoreMemoryCheckpoint } from '@/lib/memory/checkpoint-codec'
import type { AgentTurnState } from '@/lib/memory/conversation-types'
import type { AgentTurnJournalState } from '@/lib/memory/turn-journal'

/** In-memory immutable artifacts used by session tests without storage credentials. */
export function createJournalArtifactFixture() {
  const values = new Map<string, unknown>()
  let nextId = 0
  const store = async ({ input }: { input: { value: unknown } }) => {
    const id = `lv_${String(++nextId).padStart(12, '0')}`
    const key = `execution/workspace-1/workflow-1/execution-1/large-value-${id}.json`
    const ref: LargeValueRef = {
      __simLargeValueRef: true,
      version: 1,
      id,
      kind: 'object',
      size: Buffer.byteLength(JSON.stringify(input.value)),
      key,
    }
    values.set(key, structuredClone(input.value))
    return { ref, preview: 'Retained in conversation storage' }
  }
  const read = async ({ input }: { input: { ref: LargeValueRef } }) =>
    structuredClone(values.get(input.ref.key!))

  const inspect = async (encryptedState: string) => {
    const envelope = (await decryptMemoryCheckpoint(encryptedState)) as {
      identity: string
      memoryId: string
      state: AgentTurnJournalState
    }
    const payload = (ref: LargeValueRef): unknown => {
      const value = values.get(ref.key!)
      if (!isRecordLike(value)) throw new Error('Test journal artifact missing')
      return restoreMemoryCheckpoint(value.payload)
    }
    const steps = envelope.state.steps.map((step) => ({
      ...(payload(step.ref) as Record<string, unknown>),
      results: step.results.map((result) => payload(result.ref)),
    }))
    return {
      ...envelope,
      state: {
        version: 1,
        steps,
        contextUsage: envelope.state.contextUsage,
        ...(envelope.state.final ? { final: payload(envelope.state.final.ref) } : {}),
      } as AgentTurnState,
    }
  }
  return { values, store, read, inspect }
}
