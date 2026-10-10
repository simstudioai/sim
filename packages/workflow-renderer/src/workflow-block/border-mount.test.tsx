/**
 * @vitest-environment jsdom
 *
 * Handle-id normalization decides which edge ids persist, and the mount smoke test
 * exists because a knob-paint bug once threw only when a card had a coloured knob —
 * invisible on an idle canvas, fatal on node creation.
 */
import { act } from 'react'
import {
  normalizeWorkflowEdgeSourceHandle,
  normalizeWorkflowEdgeTargetHandle,
} from '@sim/workflow-types/workflow'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HANDLE_POSITIONS, normalizeCursorSourceHandleId, type WorkflowBorderPort } from '../index'

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

const _ports: WorkflowBorderPort[] = [
  { id: 'target', side: 'left', position: 'center', plateau: 33 },
  { id: 'source', side: 'right', position: 'center', plateau: 33 },
  {
    id: 'error',
    side: 'bottom',
    position: { fromEnd: HANDLE_POSITIONS.ERROR_RIGHT_OFFSET },
    plateau: 24,
    color: 'var(--text-secondary)',
  },
  {
    id: 'action-menu',
    side: 'top',
    position: { fromEnd: 24 + 82 },
    plateau: 164,
    restAmplitude: 7,
    hoverAmplitude: 7,
    magnetizable: false,
  },
]

const mountedRoots = new Set<Root>()
const mountedHosts = new Set<HTMLDivElement>()

function _mount(element: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mountedRoots.add(root)
  mountedHosts.add(host)
  act(() => {
    root.render(element)
  })
  return { host, root }
}

afterEach(() => {
  act(() => {
    mountedRoots.forEach((root) => root.unmount())
  })
  mountedRoots.clear()
  mountedHosts.forEach((host) => host.remove())
  mountedHosts.clear()
})

describe('WorkflowBlockBorder mount', () => {
  it('resolves every connection start to the one canonical source handle', () => {
    /* Which perimeter edge the drag began on is presentation only. Minting a
       side-specific id here would split edge identity: the same visual A→B
       connection could persist twice, and neither the executor nor the copilot
       edit pipeline recognizes any id but `source`. */
    expect(normalizeCursorSourceHandleId('source-cursor-left')).toBe('source')
    expect(normalizeCursorSourceHandleId('source-cursor-right')).toBe('source')
    expect(normalizeCursorSourceHandleId('source-cursor-top')).toBe('source')
    expect(normalizeCursorSourceHandleId('source-cursor-bottom')).toBe('source')
    expect(normalizeCursorSourceHandleId('source-cursor-left', 'loop')).toBe('loop-end-source')
    expect(normalizeCursorSourceHandleId('source-cursor-right', 'parallel')).toBe(
      'parallel-end-source'
    )
  })

  it('heals side-anchored handle ids back onto the canonical pair', () => {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(normalizeWorkflowEdgeSourceHandle(`source-${side}`)).toBe('source')
      expect(normalizeWorkflowEdgeTargetHandle(`target-${side}`)).toBe('target')
    }
    expect(normalizeWorkflowEdgeSourceHandle('source')).toBe('source')
    expect(normalizeWorkflowEdgeTargetHandle('target')).toBe('target')
    /* Semantic handles are untouched, and an absent handle stays absent so the
       duplicate check keeps matching what persistence actually writes. */
    expect(normalizeWorkflowEdgeSourceHandle('condition-if-id')).toBe('condition-if-id')
    expect(normalizeWorkflowEdgeSourceHandle('loop-end-source')).toBe('loop-end-source')
    expect(normalizeWorkflowEdgeSourceHandle('error')).toBe('error')
    expect(normalizeWorkflowEdgeSourceHandle('')).toBeNull()
    expect(normalizeWorkflowEdgeSourceHandle(undefined)).toBeNull()
  })
})
