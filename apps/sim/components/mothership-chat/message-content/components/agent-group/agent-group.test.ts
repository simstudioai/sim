import { describe, expect, it } from 'vitest'
import { isAgentGroupResolved } from '@/components/mothership-chat/message-content/components/agent-group/agent-group-content'
import type { AgentGroupItem } from '@/components/mothership-chat/message-content/components/agent-group/agent-group-view'
import type { ToolCallData, ToolCallStatus } from '@/lib/mothership/chat/types'

let toolSeq = 0

function tool(status: ToolCallStatus): AgentGroupItem {
  toolSeq += 1
  const data: ToolCallData = {
    id: `tool-${toolSeq}`,
    toolName: 'grep',
    displayTitle: 'Searching',
    status,
  }
  return { type: 'tool', data }
}

function group(items: AgentGroupItem[], isDelegating = false): AgentGroupItem {
  return {
    type: 'agent_group',
    group: {
      id: `group-${toolSeq}`,
      agentName: 'deploy',
      agentLabel: 'Deploy',
      items,
      isDelegating,
      isOpen: true,
    },
  }
}

describe('isAgentGroupResolved', () => {
  it('stays unresolved while a nested child is still delegating', () => {
    expect(isAgentGroupResolved([group([], true)])).toBe(false)
  })

  it('stays unresolved while a nested child has an executing tool', () => {
    expect(isAgentGroupResolved([group([tool('executing')])])).toBe(false)
  })

  it('resolves deep nesting only when every descendant is terminal', () => {
    expect(isAgentGroupResolved([group([group([tool('success')])])])).toBe(true)
    expect(isAgentGroupResolved([group([group([tool('executing')])])])).toBe(false)
  })
})
