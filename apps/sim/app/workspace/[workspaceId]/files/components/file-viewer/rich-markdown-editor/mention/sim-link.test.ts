import { describe, expect, it } from 'vitest'
import { simLinkPath } from './sim-link'

describe('simLinkPath', () => {
  const ws = 'ws1'

  // Each destination must match a real route — skills/folders deep-link via query params (no [id] route).
  it('resolves every kind to its real in-app route', () => {
    expect(simLinkPath(ws, 'file', 'f1')).toBe('/workspace/ws1/files/f1')
    expect(simLinkPath(ws, 'folder', 'd1')).toBe('/workspace/ws1/files?folderId=d1')
    expect(simLinkPath(ws, 'table', 't1')).toBe('/workspace/ws1/tables/t1')
    expect(simLinkPath(ws, 'knowledge', 'k1')).toBe('/workspace/ws1/knowledge/k1')
    expect(simLinkPath(ws, 'workflow', 'w1')).toBe('/workspace/ws1/w/w1')
    expect(simLinkPath(ws, 'skill', 's1')).toBe('/workspace/ws1/skills?skillId=s1')
  })

  it('encodes ids as a single route or query component', () => {
    expect(simLinkPath(ws, 'file', 'f/1?tab=raw')).toBe('/workspace/ws1/files/f%2F1%3Ftab%3Draw')
    expect(simLinkPath('ws/1', 'file', 'f1')).toBe('/workspace/ws%2F1/files/f1')
    expect(simLinkPath(ws, 'folder', 'd/1&archived=true')).toBe(
      '/workspace/ws1/files?folderId=d%2F1%26archived%3Dtrue'
    )
  })

  it('returns null for kinds with no navigable resource (integration) and unknown kinds', () => {
    // An integration mention's id is a block type, not a routable resource.
    expect(simLinkPath(ws, 'integration', 'slack')).toBeNull()
    expect(simLinkPath(ws, 'mystery', 'x')).toBeNull()
  })
})
