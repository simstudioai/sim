/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildForkWorkflowIdMap } from '@/ee/workspace-forking/lib/copy/workflow-id-map'

describe('buildForkWorkflowIdMap', () => {
  const sequentialIds = () => {
    let n = 0
    return () => `child-${++n}`
  }

  it('excludes a deployed source whose state failed to load from the map (and so the identity seed)', () => {
    const deployed = [{ id: 'wf-a' }, { id: 'wf-b' }, { id: 'wf-c' }]
    // wf-b's deployed state failed to load - the copy loop skips it.
    const map = buildForkWorkflowIdMap(deployed, new Set(['wf-a', 'wf-c']), sequentialIds())
    // wf-b is absent, so a copied workflow's ref to it clears (not dangle) and the identity seed
    // (derived from this map's entries) never gets an orphan row pointing at a never-created child.
    expect([...map.keys()]).toEqual(['wf-a', 'wf-c'])
    expect(map.has('wf-b')).toBe(false)
    expect(map.get('wf-a')).toBe('child-1')
    expect(map.get('wf-c')).toBe('child-2')
  })

  it('maps a both-deployed pair when both states loaded (refs remap, not clear)', () => {
    const deployed = [{ id: 'parent-wf' }, { id: 'child-wf' }]
    const map = buildForkWorkflowIdMap(
      deployed,
      new Set(['parent-wf', 'child-wf']),
      sequentialIds()
    )
    expect([...map.keys()]).toEqual(['parent-wf', 'child-wf'])
    expect(map.get('parent-wf')).toBe('child-1')
    expect(map.get('child-wf')).toBe('child-2')
  })

  it('returns an empty map when no states loaded', () => {
    const map = buildForkWorkflowIdMap([{ id: 'wf-a' }], new Set(), () => 'x')
    expect(map.size).toBe(0)
  })
})
