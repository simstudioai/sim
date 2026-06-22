/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSmoothText } from '@/hooks/use-smooth-text'

interface ProbeProps {
  content: string
  isStreaming: boolean
  snapOnNonAppend?: boolean
}

/**
 * Minimal dependency-free hook harness (the repo has no `@testing-library/react`). Mounts the hook in
 * a real React root under jsdom so effects and refs run exactly as in the app. Fake timers keep the
 * paced reveal from advancing, so each assertion observes the synchronous reveal decision only.
 */
function renderSmoothText(initial: ProbeProps) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  const props = { ...initial }
  let latest = ''

  function Probe(p: ProbeProps) {
    latest = useSmoothText(p.content, p.isStreaming, { snapOnNonAppend: p.snapOnNonAppend })
    return null
  }

  const render = () =>
    act(() => {
      root.render(<Probe {...props} />)
    })
  render()

  return {
    value: () => latest,
    rerender: (next: Partial<ProbeProps>) => {
      Object.assign(props, next)
      render()
    },
    unmount: () => act(() => root.unmount()),
  }
}

const LONG = `# Existing Document\n\n${'Lorem ipsum dolor sit amet, '.repeat(8)}`

describe('useSmoothText — streaming that begins on an already-open document', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('reveals a pre-existing document in full when an edit stream starts (no full-file replay)', () => {
    // The editor mounts showing a static file (no stream yet).
    const h = renderSmoothText({ content: '', isStreaming: false, snapOnNonAppend: true })
    expect(h.value()).toBe('')

    // The agent begins editing it: the first streamed value carries the whole existing document.
    // It must appear instantly, not replay word-by-word from the first character.
    h.rerender({ content: LONG, isStreaming: true })
    expect(h.value()).toBe(LONG)
    h.unmount()
  })

  it('still animates a brand-new file from the start (short content stays below the threshold)', () => {
    // A create stream mounts already-streaming with a tiny first chunk → begins empty and paces in.
    const h = renderSmoothText({ content: '# New file', isStreaming: true, snapOnNonAppend: true })
    expect(h.value()).toBe('')
    h.unmount()
  })

  it('shows content that is already large at mount in full (mount-time skip, unchanged)', () => {
    const h = renderSmoothText({ content: LONG, isStreaming: true, snapOnNonAppend: true })
    expect(h.value()).toBe(LONG)
    h.unmount()
  })

  it('does not pre-reveal for chat (mounts already streaming with a small first chunk)', () => {
    // Chat (no snapOnNonAppend) mounts streaming; the not-streaming→streaming edge never occurs, so
    // the new transition skip cannot fire and ordinary paced reveal is preserved.
    const h = renderSmoothText({ content: 'Hello', isStreaming: true })
    expect(h.value()).toBe('')
    h.unmount()
  })
})
