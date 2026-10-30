import { describe, expect, it } from 'vitest'
import type { AgentGroupItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import { getLaneLiveIndicator } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/lane-activity'
import type { ToolCallData } from '@/app/workspace/[workspaceId]/home/types'

function call(id: string, toolName: string, extra: Partial<ToolCallData> = {}): AgentGroupItem {
  return { type: 'tool', data: { id, toolName, displayTitle: id, status: 'success', ...extra } }
}

const liveId = (items: AgentGroupItem[], isOpen = true) => {
  const indicator = getLaneLiveIndicator({ kind: 'main', parts: [items], isActive: true, isOpen })
  return indicator?.type === 'call' ? indicator.tool.id : indicator?.type
}

describe('getLaneLiveIndicator', () => {
  it.each([false, true])(
    'leaves the turn indicator visible when a settled action is lifted (nested: %s)',
    (nested) => {
      const action = call('action', 'jira_write')
      const items: AgentGroupItem[] = nested
        ? [
            {
              type: 'agent_group',
              group: {
                id: 'child',
                agentName: 'research',
                agentLabel: 'Research',
                items: [action],
                isDelegating: false,
                isOpen: true,
              },
            },
          ]
        : [action]
      const input = {
        kind: 'subagent' as const,
        parts: [items],
        isActive: true,
        isOpen: true,
        standaloneToolIds: new Set(['action']),
      }
      expect(getLaneLiveIndicator(input)).toBeUndefined()
      expect(
        getLaneLiveIndicator({
          ...input,
          parts: [[...items, { type: 'text', content: 'Checking the result.' }]],
        })
      ).toEqual({ type: 'narration' })
    }
  )

  it('gives the gap to a succeeded trailing call, including search, never a failure', () => {
    expect(liveId([call('s', 'search_workspace'), call('a', 'read')])).toBe('a')
    expect(liveId([call('a', 'read'), call('s', 'search_workspace')])).toBe('s')
    expect(liveId([call('a', 'read'), call('b', 'read', { status: 'error' })])).toBeUndefined()
    expect(liveId([call('a', 'read')], false)).toBeUndefined()
  })
})
