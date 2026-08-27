import { describe, expect, it } from 'vitest'
import { getRecentlyDeletedQueryPlan } from '@/app/workspace/[workspaceId]/settings/components/recently-deleted/query-plan'

describe('getRecentlyDeletedQueryPlan', () => {
  it('loads every resource family for the aggregate tab', () => {
    expect(Object.values(getRecentlyDeletedQueryPlan('all')).every(Boolean)).toBe(true)
  })

  it.each([
    ['workflow', ['workflows']],
    ['folder', ['folders']],
    ['table', ['tables', 'tableFolders']],
    ['knowledge', ['knowledge', 'knowledgeFolders']],
    ['file', ['files', 'workspaceFolders']],
    ['chat', ['chats']],
  ] as const)('loads only the %s tab resource families', (tab, enabledKeys) => {
    const plan = getRecentlyDeletedQueryPlan(tab)
    const enabled = Object.entries(plan)
      .filter(([, isEnabled]) => isEnabled)
      .map(([key]) => key)

    expect(enabled).toEqual(enabledKeys)
  })
})
