/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type AgentStreamToolCall,
  applyToolCallPhase,
} from '@/components/agent-stream/tool-call-lifecycle'

describe('applyToolCallPhase', () => {
  it('uses the shared display resolver for MCP tool names', () => {
    const tools = new Map<string, AgentStreamToolCall>()
    const order: string[] = []

    applyToolCallPhase(
      tools,
      order,
      {
        key: 'agent-1:call-1',
        id: 'call-1',
        name: 'mcp-6da535c1-ask_question',
        phase: 'start',
      },
      (tool) => tool
    )

    expect(tools.get('agent-1:call-1')?.displayName).toBe('Ask Question')
  })
})
