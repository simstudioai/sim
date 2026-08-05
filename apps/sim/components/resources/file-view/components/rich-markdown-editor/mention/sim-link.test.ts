import { describe, expect, it } from 'vitest'
import { shareSource, workspaceSource } from '@/resources'
import { simLinkPath } from './sim-link'

describe('simLinkPath', () => {
  const source = workspaceSource({ kind: 'file', workspaceId: 'ws1', resourceId: 'host' })

  // Each destination must match a real route — skills/folders deep-link via query params (no [id] route).
  it('resolves every kind to its real in-app route', () => {
    expect(simLinkPath(source, 'file', 'f1')).toBe('/workspace/ws1/files/f1/view')
    expect(simLinkPath(source, 'folder', 'd1')).toBe('/workspace/ws1/files?folderId=d1')
    expect(simLinkPath(source, 'table', 't1')).toBe('/workspace/ws1/tables/t1')
    expect(simLinkPath(source, 'knowledge', 'k1')).toBe('/workspace/ws1/knowledge/k1')
    expect(simLinkPath(source, 'workflow', 'w1')).toBe('/workspace/ws1/w/w1')
    expect(simLinkPath(source, 'skill', 's1')).toBe('/workspace/ws1/skills?skillId=s1')
  })

  it('returns null for kinds with no navigable resource (integration) and unknown kinds', () => {
    // An integration mention's id is a block type, not a routable resource.
    expect(simLinkPath(source, 'integration', 'slack')).toBeNull()
    expect(simLinkPath(source, 'mystery', 'x')).toBeNull()
  })

  /** `/f/[token]` has no `[workspaceId]` segment, so nothing is navigable from a share. */
  it('returns null for every kind against a share source', () => {
    const shared = shareSource({
      kind: 'file',
      token: 'tok',
      grantId: 'tok',
      seed: { name: 'notes.md', type: 'text/markdown', size: 12, version: 1 },
    })
    for (const kind of ['file', 'folder', 'table', 'knowledge', 'workflow', 'skill']) {
      expect(simLinkPath(shared, kind, 'x')).toBeNull()
    }
  })
})
