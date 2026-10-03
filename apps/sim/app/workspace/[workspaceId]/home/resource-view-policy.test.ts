import { describe, expect, it } from 'vitest'
import {
  getChatResourceSelectionId,
  type MothershipResource,
} from '@/lib/mothership/resources/types'
import { resolveEffectiveResourceId } from '@/app/workspace/[workspaceId]/home/resource-view-policy'

const PAGES: MothershipResource[] = [
  { type: 'browser', id: '1', title: 'Page 1' },
  { type: 'browser', id: '2', title: 'Page 2' },
  { type: 'browser', id: '3', title: 'Page 3' },
]
const SHELLS: MothershipResource[] = [
  { type: 'terminal', id: 'terminal:1', title: 'one' },
  { type: 'terminal', id: 'terminal:2', title: 'two' },
]
const NO_NATIVE = { browser: null, terminal: null }

describe('resolveEffectiveResourceId', () => {
  it('preserves workspace-qualified selection and fallback for files and tables', () => {
    const resources: MothershipResource[] = [
      { type: 'file', id: 'wf_same', title: 'Report', workspaceId: 'workspace-a' },
      { type: 'file', id: 'wf_same', title: 'Report', workspaceId: 'workspace-b' },
      { type: 'table', id: 'tbl_inventory', title: 'Inventory', workspaceId: 'workspace-b' },
    ]
    for (const resource of resources) {
      const selection = getChatResourceSelectionId(resource)
      expect(resolveEffectiveResourceId(resources, selection, NO_NATIVE)).toBe(selection)
    }
    expect(resolveEffectiveResourceId(resources, null, NO_NATIVE)).toBe(
      getChatResourceSelectionId(resources[2])
    )
    expect(resolveEffectiveResourceId(resources, 'wf_same', NO_NATIVE)).toBe(
      getChatResourceSelectionId(resources[2])
    )
  })

  it('does not cross the two desktop kinds', () => {
    expect(resolveEffectiveResourceId(PAGES, null, { browser: null, terminal: 'terminal:1' })).toBe(
      '3'
    )
    expect(resolveEffectiveResourceId(SHELLS, null, { browser: '1', terminal: null })).toBe(
      'terminal:2'
    )
  })
})
