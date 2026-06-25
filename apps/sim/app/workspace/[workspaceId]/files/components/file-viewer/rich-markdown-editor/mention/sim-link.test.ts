import { describe, expect, it } from 'vitest'
import { parseSimHref, simLinkPath } from './sim-link'

describe('parseSimHref', () => {
  it('parses a sim mention href', () => {
    expect(parseSimHref('sim:file/abc-123')).toEqual({ kind: 'file', id: 'abc-123' })
    expect(parseSimHref('sim:knowledge/kb_1')).toEqual({ kind: 'knowledge', id: 'kb_1' })
  })

  it('returns null for non-sim hrefs', () => {
    expect(parseSimHref('https://sim.ai')).toBeNull()
    expect(parseSimHref('sim:file')).toBeNull()
    expect(parseSimHref('mailto:x@y.com')).toBeNull()
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
    expect(simLinkPath(ws, 'integration', 'slack')).toBe('/workspace/ws1/integrations/slack')
  })

  it('returns null for an unknown kind', () => {
    expect(simLinkPath(ws, 'mystery', 'x')).toBeNull()
  })
})
