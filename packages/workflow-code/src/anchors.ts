/**
 * String forms of ports and comment anchors. Edges sort by `portKey`, and comment maps (in the CWM
 * and in `workflow_source_meta`) are keyed by `encodeAnchor`, so every engine must use these and
 * never format either by hand.
 */

import type { Anchor, AnchorKey, Port, PortKey } from './model'

/** The string form of a port: `out`, `error`, `branch:<key>`, `subflowStart`, `subflowEnd`, `raw:<handle>`. */
export function portKey(port: Port): PortKey {
  switch (port.kind) {
    case 'branch':
      return `branch:${port.key}`
    case 'raw':
      return `raw:${port.handle}`
    default:
      return port.kind
  }
}

/**
 * The identity of an edge, `from`, port key and `to` joined by NUL, which no block key or port key
 * contains. Every engine dedupes and matches edges by this key.
 */
export function edgeTupleKey(from: string, port: string, to: string): string {
  return `${from}\u0000${port}\u0000${to}`
}

/** Inverse of {@link portKey}; `null` for a string it cannot produce. */
function parsePortKey(text: string): Port | null {
  switch (text) {
    case 'out':
    case 'error':
    case 'subflowStart':
    case 'subflowEnd':
      return { kind: text }
  }
  if (text.startsWith('branch:') && text.length > 'branch:'.length) {
    return { kind: 'branch', key: text.slice('branch:'.length) }
  }
  if (text.startsWith('raw:') && text.length > 'raw:'.length) {
    return { kind: 'raw', handle: text.slice('raw:'.length) }
  }
  return null
}

function escapeSegment(segment: string): string {
  return segment.replace(/%/g, '%25').replace(/:/g, '%3A')
}

/** `null` when the segment holds a `%` that is not one of the two escapes `escapeSegment` writes. */
function unescapeSegment(segment: string): string | null {
  if (/%(?!25|3A)/.test(segment)) return null
  return segment.replace(/%3A/g, ':').replace(/%25/g, '%')
}

function brand(text: string): AnchorKey {
  return text as AnchorKey
}

/**
 * Serializes an anchor as `<kind>[:<segment>...]`, each segment with `%` → `%25` and `:` → `%3A`,
 * so block keys, subBlock ids and port keys may contain either character. Injective: distinct
 * anchors never share a key.
 */
export function encodeAnchor(anchor: Anchor): AnchorKey {
  switch (anchor.kind) {
    case 'header':
    case 'wiring':
    case 'footer':
      return brand(anchor.kind)
    case 'block':
      return brand(`block:${escapeSegment(anchor.block)}`)
    case 'param':
      return brand(`param:${escapeSegment(anchor.block)}:${escapeSegment(anchor.param)}`)
    case 'edges':
      return brand(`edges:${escapeSegment(anchor.block)}:${escapeSegment(anchor.port)}`)
    case 'var':
      return brand(`var:${escapeSegment(anchor.variable)}`)
  }
}

/** Inverse of {@link encodeAnchor}; `null` for any string it cannot produce. */
export function decodeAnchor(text: string): Anchor | null {
  const [kind, ...raw] = text.split(':')
  const segments: string[] = []
  for (const segment of raw) {
    const decoded = unescapeSegment(segment)
    if (decoded === null || decoded === '') return null
    segments.push(decoded)
  }
  switch (kind) {
    case 'header':
    case 'wiring':
    case 'footer':
      return segments.length === 0 && raw.length === 0 ? { kind } : null
    case 'block':
      return segments.length === 1 ? { kind, block: segments[0] } : null
    case 'var':
      return segments.length === 1 ? { kind, variable: segments[0] } : null
    case 'param':
      return segments.length === 2 ? { kind, block: segments[0], param: segments[1] } : null
    case 'edges': {
      if (segments.length !== 2) return null
      const port = parsePortKey(segments[1])
      return port ? { kind, block: segments[0], port: portKey(port) } : null
    }
    default:
      return null
  }
}
