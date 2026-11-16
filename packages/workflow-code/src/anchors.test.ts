import { describe, expect, it } from 'vitest'
import { decodeAnchor, encodeAnchor, portKey } from './anchors'
import type { Anchor, Port, PortKey } from './model'

function edgesAnchor(port: PortKey): Anchor {
  return { kind: 'edges', block: 'b', port }
}

describe('portKey in edges anchors', () => {
  it('round-trips every port kind, including handles that contain colons', () => {
    const ports: Port[] = [
      { kind: 'out' },
      { kind: 'error' },
      { kind: 'branch', key: 'elseIf0' },
      { kind: 'subflowStart' },
      { kind: 'subflowEnd' },
      { kind: 'raw', handle: 'legacy:handle:1' },
    ]
    for (const port of ports) {
      const anchor = edgesAnchor(portKey(port))
      expect(decodeAnchor(encodeAnchor(anchor))).toEqual(anchor)
    }
    expect(portKey({ kind: 'branch', key: 'if' })).toBe('branch:if')
  })

  it('rejects unknown kinds and empty payloads', () => {
    for (const text of ['source', 'branch:', 'raw:', 'out:x', '']) {
      expect(decodeAnchor(encodeAnchor(edgesAnchor(text as PortKey))), text).toBeNull()
    }
  })
})

describe('encodeAnchor / decodeAnchor', () => {
  it('round-trips every anchor kind, even when keys contain the separator or escapes', () => {
    const anchors: Anchor[] = [
      { kind: 'header' },
      { kind: 'wiring' },
      { kind: 'footer' },
      { kind: 'block', block: 'a:b%3A~2' },
      { kind: 'param', block: 'agent', param: 'credential' },
      { kind: 'param', block: 'agent', param: 'old:field' },
      { kind: 'edges', block: 'route', port: 'branch:elseIf0' },
      { kind: 'edges', block: 'x', port: 'raw:a:b' },
      { kind: 'var', variable: 'retries' },
    ]
    const keys = anchors.map(encodeAnchor)
    expect(new Set(keys).size).toBe(anchors.length)
    keys.forEach((key, i) => expect(decodeAnchor(key)).toEqual(anchors[i]))
  })

  it('escapes only % and : so plain keys stay readable', () => {
    expect(encodeAnchor({ kind: 'param', block: 'agent', param: 'model' })).toBe(
      'param:agent:model'
    )
    expect(encodeAnchor({ kind: 'edges', block: 'r', port: 'branch:if' })).toBe(
      'edges:r:branch%3Aif'
    )
    expect(encodeAnchor({ kind: 'block', block: '50%' })).toBe('block:50%25')
  })

  it('returns null for anything encodeAnchor cannot produce', () => {
    for (const text of [
      '',
      'nope',
      'header:x',
      'block',
      'block:',
      'block:a:b',
      'param:a',
      'edges:a:source',
      'block:50%',
      'block:%zz',
      'block:%3a',
    ]) {
      expect(decodeAnchor(text), text).toBeNull()
    }
  })
})
