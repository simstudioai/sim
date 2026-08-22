import { describe, expect, it } from 'vitest'
import { fromSimHrefId, toSimHref } from '@/lib/copilot/sim-link'
import { simLinkPath } from './sim-link'

describe('sim link id codec', () => {
  it('round-trips identifiers containing link delimiters', () => {
    const id = 'files/Q1 plan).md'
    const href = toSimHref('file', id)

    expect(href).toBe('sim:file/files/Q1%20plan%29.md')
    expect(fromSimHrefId(href.slice('sim:file/'.length))).toBe(id)
  })

  it('leaves malformed percent encoding intact', () => {
    expect(fromSimHrefId('file%2')).toBe('file%2')
  })
})

describe('simLinkPath', () => {
  const ws = 'ws1'

  // Each destination must match a real route — skills/folders deep-link via query params (no [id] route).
  it('resolves every kind to its real in-app route', () => {
    expect(simLinkPath(ws, 'file', 'f1')).toBe('/workspace/ws1/files/f1/view')
    expect(simLinkPath(ws, 'folder', 'd1')).toBe('/workspace/ws1/files?folderId=d1')
    expect(simLinkPath(ws, 'table', 't1')).toBe('/workspace/ws1/tables/t1')
    expect(simLinkPath(ws, 'knowledge', 'k1')).toBe('/workspace/ws1/knowledge/k1')
    expect(simLinkPath(ws, 'workflow', 'w1')).toBe('/workspace/ws1/w/w1')
    expect(simLinkPath(ws, 'skill', 's1')).toBe('/workspace/ws1/skills?skillId=s1')
  })

  it('returns null for kinds with no navigable resource (integration) and unknown kinds', () => {
    // An integration mention's id is a block type, not a routable resource.
    expect(simLinkPath(ws, 'integration', 'slack')).toBeNull()
    expect(simLinkPath(ws, 'mystery', 'x')).toBeNull()
  })
})
