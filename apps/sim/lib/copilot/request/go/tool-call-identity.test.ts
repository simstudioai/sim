/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createProviderToolCallIdentity,
  PROVIDER_TOOL_CALL_IDENTITY_LIMITS,
  restoreProviderToolCallId,
  scopeProviderToolCallEvent,
  scopeProviderToolCallId,
} from '@/lib/copilot/request/go/tool-call-identity'
import {
  markToolResultSeen,
  shouldSkipToolCallEvent,
  shouldSkipToolResultEvent,
} from '@/lib/copilot/request/sse-utils'
import type { StreamEvent } from '@/lib/copilot/request/types'

function toolCall(toolCallId: string): StreamEvent {
  return {
    type: 'tool',
    payload: {
      phase: 'call',
      toolCallId,
      toolName: 'glob',
      executor: 'client',
      mode: 'async',
      arguments: { toolCallId, nested: { tool_call_id: toolCallId } },
    },
  }
}

describe('provider tool-call identity boundary', () => {
  it('bounds retained entries while allowing replay at the limit', () => {
    const identity = createProviderToolCallIdentity('bounded-run')
    const first = scopeProviderToolCallId('0', identity)
    for (let index = 1; index < PROVIDER_TOOL_CALL_IDENTITY_LIMITS.maxEntries; index++) {
      scopeProviderToolCallId(String(index), identity)
    }
    const bytes = identity.retainedBytes
    expect(scopeProviderToolCallId('0', identity)).toBe(first)
    expect(identity.retainedBytes).toBe(bytes)
    expect(() => scopeProviderToolCallId('one-more', identity)).toThrow('identity budget exceeded')
    expect(identity.providerIds.size).toBe(PROVIDER_TOOL_CALL_IDENTITY_LIMITS.maxEntries)
  })

  it('bounds provider IDs and cumulative string bytes without evicting pending mappings', () => {
    const identity = createProviderToolCallIdentity('byte-bounded-run')
    const { maxIdChars, maxRetainedBytes } = PROVIDER_TOOL_CALL_IDENTITY_LIMITS
    expect(() => scopeProviderToolCallId('x'.repeat(maxIdChars + 1), identity)).toThrow(
      'supported length'
    )
    expect(identity.providerIds.size).toBe(0)
    const raw = 'x'.repeat(maxIdChars)
    const first = scopeProviderToolCallId(raw, identity)
    for (
      let index = 1;
      identity.retainedBytes + 2 * (maxIdChars + 73) <= maxRetainedBytes;
      index++
    ) {
      scopeProviderToolCallId(String(index).padEnd(maxIdChars, 'x'), identity)
    }
    expect(() => scopeProviderToolCallId('y'.repeat(maxIdChars), identity)).toThrow(
      'identity budget exceeded'
    )
    expect(identity.retainedBytes).toBeLessThanOrEqual(maxRetainedBytes)
    expect(restoreProviderToolCallId(first, identity)).toBe(raw)
  })

  it('isolates runs, is stable on replay, and keeps long provider IDs within native limits', () => {
    const first = createProviderToolCallIdentity('run-1')
    const second = createProviderToolCallIdentity('run-2')
    const rawId = 'provider-'.repeat(1000)
    const firstId = scopeProviderToolCallId(rawId, first)
    const secondId = scopeProviderToolCallId(rawId, second)

    expect(firstId).not.toBe(secondId)
    expect(firstId.length).toBeLessThanOrEqual(256)
    expect(scopeProviderToolCallId(rawId, first)).toBe(firstId)
    expect(restoreProviderToolCallId(firstId, first)).toBe(rawId)
    expect(first.providerIds.size).toBe(1)
  })

  it('treats a provider ID that resembles a Sim ID as a new opaque input', () => {
    const identity = createProviderToolCallIdentity('prefix-run')
    const rawId = `sim_tool_${'a'.repeat(64)}`
    const canonicalId = scopeProviderToolCallId(rawId, identity)
    expect(canonicalId).not.toBe(rawId)
    expect(restoreProviderToolCallId(canonicalId, identity)).toBe(rawId)
    expect(restoreProviderToolCallId(rawId)).toBe(rawId)
  })

  it('refuses to send a canonical ID to Go after losing its reverse mapping', () => {
    const canonicalId = scopeProviderToolCallId('call-1', createProviderToolCallIdentity('run'))
    expect(() =>
      restoreProviderToolCallId(canonicalId, createProviderToolCallIdentity('run'))
    ).toThrow('Provider tool call identity is missing')
    expect(restoreProviderToolCallId('legacy-call-1')).toBe('legacy-call-1')
  })

  it('normalizes before global call/result dedupe so one run cannot suppress another', () => {
    const first = createProviderToolCallIdentity('dedupe-run-1')
    const second = createProviderToolCallIdentity('dedupe-run-2')
    const firstEvent = scopeProviderToolCallEvent(toolCall('provider-shared-call'), first)
    const secondEvent = scopeProviderToolCallEvent(toolCall('provider-shared-call'), second)
    expect(shouldSkipToolCallEvent(firstEvent)).toBe(false)
    expect(shouldSkipToolCallEvent(firstEvent)).toBe(true)
    markToolResultSeen(scopeProviderToolCallId('provider-shared-call', first))
    expect(shouldSkipToolCallEvent(secondEvent)).toBe(false)
    expect(
      shouldSkipToolResultEvent(
        scopeProviderToolCallEvent(
          {
            type: 'tool',
            payload: {
              phase: 'result',
              toolCallId: 'provider-shared-call',
              toolName: 'glob',
              executor: 'client',
              mode: 'async',
              success: true,
            },
          },
          second
        )
      )
    ).toBe(false)
  })

  it('maps checkpoint-only IDs and all parent references consistently without touching payloads', () => {
    const identity = createProviderToolCallIdentity('checkpoint-run')
    const checkpoint: StreamEvent = {
      type: 'run',
      scope: { lane: 'subagent', parentToolCallId: 'parent' },
      payload: {
        kind: 'checkpoint_pause',
        checkpointId: 'checkpoint',
        executionId: 'execution',
        runId: 'provider-run',
        pendingToolCallIds: ['pending-only'],
        frames: [
          {
            parentToolCallId: 'parent',
            parentToolName: 'files',
            pendingToolIds: ['pending-only'],
            checkpointId: 'child-checkpoint',
          },
        ],
      },
    }
    const mapped = scopeProviderToolCallEvent(checkpoint, identity)
    const parentId = scopeProviderToolCallId('parent', identity)
    const pendingId = scopeProviderToolCallId('pending-only', identity)
    expect(mapped).toEqual({
      ...checkpoint,
      scope: { lane: 'subagent', parentToolCallId: parentId },
      payload: {
        ...checkpoint.payload,
        pendingToolCallIds: [pendingId],
        frames: [
          {
            parentToolCallId: parentId,
            parentToolName: 'files',
            pendingToolIds: [pendingId],
            checkpointId: 'child-checkpoint',
          },
        ],
      },
    })
    expect(restoreProviderToolCallId(pendingId, identity)).toBe('pending-only')
    expect(checkpoint.payload.pendingToolCallIds).toEqual(['pending-only'])

    const call = toolCall('pending-only')
    expect(scopeProviderToolCallEvent(call, identity)).toEqual({
      ...call,
      payload: { ...call.payload, toolCallId: pendingId },
    })
    expect(scopeProviderToolCallEvent(call)).toBe(call)
  })

  it('maps both subagent span ID spellings and leaves structured result data opaque', () => {
    const identity = createProviderToolCallIdentity('span-run')
    const data = { tool_call_id: 'parent', toolCallId: 'parent', nested: { toolCallId: 'parent' } }
    const span: StreamEvent = {
      type: 'span',
      payload: { kind: 'subagent', event: 'start', data },
    }
    const parentId = scopeProviderToolCallId('parent', identity)
    expect(scopeProviderToolCallEvent(span, identity)).toEqual({
      ...span,
      payload: {
        ...span.payload,
        data: { ...data, tool_call_id: parentId, toolCallId: parentId },
      },
    })
    const result: StreamEvent = {
      type: 'span',
      payload: { kind: 'structured_result', data },
    }
    expect(scopeProviderToolCallEvent(result, identity)).toBe(result)
  })
})
