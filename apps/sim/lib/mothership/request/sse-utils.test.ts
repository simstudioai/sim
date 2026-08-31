import { describe, expect, it } from 'vitest'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ToolExecutor,
  MothershipStreamV1ToolMode,
  MothershipStreamV1ToolPhase,
} from '@/lib/mothership/generated/mothership-stream-v1'
import { TOOL_CALL_STATUS } from '@/lib/mothership/request/session'
import type { StreamEvent } from '@/lib/mothership/request/types'
import { shouldSkipToolCallEvent } from './sse-utils'

const freshScope = () => ({ seenToolCalls: new Set<string>(), seenToolResults: new Set<string>() })

describe('shouldSkipToolCallEvent', () => {
  it('skips pathless read and glob generating placeholders without marking the call seen', () => {
    const readEvent = toolCallEvent('read-generating-placeholder', 'read', undefined, true)
    const globEvent = toolCallEvent('glob-generating-placeholder', 'glob', undefined, true)

    expect(shouldSkipToolCallEvent(freshScope(), readEvent)).toBe(true)
    expect(shouldSkipToolCallEvent(freshScope(), globEvent)).toBe(true)

    expect(
      shouldSkipToolCallEvent(
        freshScope(),
        toolCallEvent('read-generating-placeholder', 'read', {
          path: 'components/integrations/slack/README.md',
        })
      )
    ).toBe(false)
    expect(
      shouldSkipToolCallEvent(
        freshScope(),
        toolCallEvent('glob-generating-placeholder', 'glob', {
          pattern: 'components/blocks/*/README.md',
        })
      )
    ).toBe(false)
  })

  it('keeps non-vfs generating placeholders visible', () => {
    expect(
      shouldSkipToolCallEvent(
        freshScope(),
        toolCallEvent('search-generating-placeholder', 'web_search', undefined, true)
      )
    ).toBe(false)
  })

  it('allows a gateway call id to rebind to its resolved integration operation', () => {
    const callId = 'gateway-resolve-call'
    const gateway = toolCallEvent(callId, 'call_integration_tool', {
      toolId: 'gmail_read_v2',
      description: 'Reading recent emails',
      arguments: {},
    })
    const resolved = toolCallEvent(callId, 'gmail_read_v2', {
      credentialId: 'cred-gmail',
    })

    const scope = freshScope()
    expect(shouldSkipToolCallEvent(scope, gateway)).toBe(false)
    expect(shouldSkipToolCallEvent(scope, gateway)).toBe(true)
    expect(shouldSkipToolCallEvent(scope, resolved)).toBe(false)
    expect(shouldSkipToolCallEvent(scope, resolved)).toBe(true)
  })
})

function toolCallEvent(
  toolCallId: string,
  toolName: string,
  args?: Record<string, unknown>,
  generating = false
): StreamEvent {
  return {
    type: MothershipStreamV1EventType.tool,
    payload: {
      toolCallId,
      toolName,
      executor: MothershipStreamV1ToolExecutor.go,
      mode: MothershipStreamV1ToolMode.sync,
      phase: MothershipStreamV1ToolPhase.call,
      ...(generating ? { status: TOOL_CALL_STATUS.generating } : {}),
      ...(args ? { arguments: args } : {}),
    },
  } satisfies StreamEvent
}
