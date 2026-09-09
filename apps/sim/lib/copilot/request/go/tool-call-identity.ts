import { createHash } from 'node:crypto'
import { isRecordLike } from '@sim/utils/object'
import type { StreamEvent } from '@/lib/copilot/request/types'

export const PROVIDER_TOOL_CALL_IDENTITY_LIMITS = {
  maxEntries: 10_000,
  maxIdChars: 16_384,
  maxRetainedBytes: 4 * 1024 * 1024,
} as const

export interface ProviderToolCallIdentity {
  namespace: string
  providerIds: Map<string, string>
  retainedBytes: number
}

export function createProviderToolCallIdentity(namespace: string): ProviderToolCallIdentity {
  return { namespace, providerIds: new Map(), retainedBytes: 0 }
}

/** Provider IDs are only unique within a run; Sim persists and publishes globally unique IDs. */
export function scopeProviderToolCallId(
  providerId: string,
  identity: ProviderToolCallIdentity
): string {
  if (providerId.length > PROVIDER_TOOL_CALL_IDENTITY_LIMITS.maxIdChars) {
    throw new Error('Provider tool call ID exceeds the supported length')
  }
  const digest = createHash('sha256')
    .update(JSON.stringify([identity.namespace, providerId]))
    .digest('hex')
  const toolCallId = `sim_tool_${digest}`
  if (identity.providerIds.has(toolCallId)) return toolCallId
  /** Two bytes per UTF-16 code unit conservatively bounds retained string storage. */
  const retainedBytes = identity.retainedBytes + 2 * (toolCallId.length + providerId.length)
  if (
    identity.providerIds.size >= PROVIDER_TOOL_CALL_IDENTITY_LIMITS.maxEntries ||
    retainedBytes > PROVIDER_TOOL_CALL_IDENTITY_LIMITS.maxRetainedBytes
  ) {
    throw new Error('Provider tool call identity budget exceeded')
  }
  identity.providerIds.set(toolCallId, providerId)
  identity.retainedBytes = retainedBytes
  return toolCallId
}

/** Only runs that opted into namespacing decode IDs on the return trip to Go. */
export function restoreProviderToolCallId(
  toolCallId: string,
  identity?: ProviderToolCallIdentity
): string {
  if (!identity) return toolCallId
  const providerId = identity.providerIds.get(toolCallId)
  if (providerId !== undefined) return providerId
  if (/^sim_tool_[a-f0-9]{64}$/.test(toolCallId)) {
    throw new Error('Provider tool call identity is missing from the active run')
  }
  return toolCallId
}

/** Translate protocol references without changing opaque tool arguments, results, or resources. */
export function scopeProviderToolCallEvent(
  event: StreamEvent,
  identity?: ProviderToolCallIdentity
): StreamEvent {
  if (!identity) return event
  const scopeId = (id: string) => scopeProviderToolCallId(id, identity)
  const scoped = event.scope?.parentToolCallId
    ? {
        ...event,
        scope: { ...event.scope, parentToolCallId: scopeId(event.scope.parentToolCallId) },
      }
    : event

  if (scoped.type === 'tool') {
    const mapped = { ...scoped }
    mapped.payload = { ...scoped.payload, toolCallId: scopeId(scoped.payload.toolCallId) }
    return mapped
  }
  if (scoped.type === 'run' && scoped.payload.kind === 'checkpoint_pause') {
    return {
      ...scoped,
      payload: {
        ...scoped.payload,
        pendingToolCallIds: scoped.payload.pendingToolCallIds.map(scopeId),
        ...(scoped.payload.frames
          ? {
              frames: scoped.payload.frames.map((frame) => ({
                ...frame,
                parentToolCallId: scopeId(frame.parentToolCallId),
                pendingToolIds: frame.pendingToolIds.map(scopeId),
              })),
            }
          : {}),
      },
    }
  }
  if (
    scoped.type === 'span' &&
    scoped.payload.kind === 'subagent' &&
    isRecordLike(scoped.payload.data)
  ) {
    const mapped = { ...scoped }
    mapped.payload = {
      ...scoped.payload,
      data: {
        ...scoped.payload.data,
        ...(typeof scoped.payload.data.tool_call_id === 'string'
          ? { tool_call_id: scopeId(scoped.payload.data.tool_call_id) }
          : {}),
        ...(typeof scoped.payload.data.toolCallId === 'string'
          ? { toolCallId: scopeId(scoped.payload.data.toolCallId) }
          : {}),
      },
    }
    return mapped
  }
  return scoped
}
