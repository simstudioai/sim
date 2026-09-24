/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import type { AgentGroupItem } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import {
  getLaneLiveIndicator,
  splitMainLane,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/lane-activity'
import type { ToolCallData } from '@/app/workspace/[workspaceId]/home/types'

function call(id: string, toolName: string, extra: Partial<ToolCallData> = {}): AgentGroupItem {
  return { type: 'tool', data: { id, toolName, displayTitle: id, status: 'success', ...extra } }
}

const layout = (items: AgentGroupItem[]) =>
  splitMainLane(items).map((entry) =>
    entry.type === 'run'
      ? `tools:${entry.run.tools.map((tool) => tool.id).join(',')}`
      : entry.item.type
  )

const liveId = (items: AgentGroupItem[], isOpen = true) => {
  const indicator = getLaneLiveIndicator({ kind: 'main', parts: [items], isActive: true, isOpen })
  return indicator?.type === 'call' ? indicator.tool.id : indicator?.type
}

describe('splitMainLane', () => {
  it('groups search with other tools and splits only at interactions, in transcript order', () => {
    expect(
      layout([
        call('a', 'read'),
        call('s1', 'search_workspace'),
        call('s2', 'search_sources', { params: { action: 'list' } }),
        call('setup', 'search_sources', { params: { action: 'setup' } }),
        call('b', 'grep'),
        call('approval', 'edit_workflow', { status: 'awaiting_approval' }),
        call('c', 'read'),
      ])
    ).toEqual(['tools:a,s1,s2,setup,b', 'tool', 'tools:c'])
  })
})

describe('getLaneLiveIndicator', () => {
  it('picks the newest running call across every run and segment of the lane', () => {
    const indicator = getLaneLiveIndicator({
      kind: 'main',
      parts: [
        [call('a', 'read', { status: 'executing', startedAt: 2 })],
        [call('s', 'search_workspace', { status: 'executing', startedAt: 1 })],
      ],
      isActive: true,
      isOpen: true,
    })
    expect(indicator?.type === 'call' && indicator.tool.id).toBe('a')
  })

  it('gives the gap to a succeeded trailing call, including search, never a failure', () => {
    expect(liveId([call('s', 'search_workspace'), call('a', 'read')])).toBe('a')
    expect(liveId([call('a', 'read'), call('s', 'search_workspace')])).toBe('s')
    expect(liveId([call('a', 'read'), call('b', 'read', { status: 'error' })])).toBeUndefined()
    expect(liveId([call('a', 'read')], false)).toBeUndefined()
  })

  it('has no indicator while the lane waits on the user', () => {
    expect(
      liveId([
        call('a', 'read', { status: 'executing' }),
        call('approval', 'edit_workflow', { status: 'awaiting_approval' }),
      ])
    ).toBeUndefined()
  })
})
