/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { snapAllSmoothText, useSmoothText } from '@/hooks/use-smooth-text'

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
  const values: string[] = []

  function Probe(p: ProbeProps) {
    latest = useSmoothText(p.content, p.isStreaming, { snapOnNonAppend: p.snapOnNonAppend })
    values.push(latest)
    return null
  }

  const render = () =>
    act(() => {
      root.render(<Probe {...props} />)
    })
  render()

  return {
    value: () => latest,
    values: () => values,
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

describe('useSmoothText — frame cadence and completion', () => {
  let now = 0
  let frameId = 0
  const frames = new Map<number, FrameRequestCallback>()

  beforeEach(() => {
    now = 0
    frameId = 0
    frames.clear()
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback)
      return frameId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function frame(dt: number) {
    now += dt
    const callbacks = [...frames.values()]
    frames.clear()
    act(() => {
      for (const callback of callbacks) callback(now)
    })
  }

  function advance(duration: number, refreshRate = 120) {
    for (let elapsed = 0; elapsed < duration; elapsed += 1000 / refreshRate) {
      frame(1000 / refreshRate)
    }
  }

  it.each([60, 90, 120, 144])('paces at most 60 React updates/sec on a %s Hz display', (rate) => {
    const probe = renderSmoothText({ content: '', isStreaming: true })
    probe.rerender({ content: 'word '.repeat(2000) })
    const before = probe.values().length
    advance(1000, rate)
    const updates = probe.values().slice(before)
    expect(updates.length).toBeGreaterThanOrEqual(58)
    expect(updates.length).toBeLessThanOrEqual(61)
    expect(probe.value().length).toBeGreaterThan(2300)
    expect(probe.value().length).toBeLessThan(2450)
    for (let index = 1; index < updates.length; index++) {
      expect(updates[index].startsWith(updates[index - 1])).toBe(true)
      expect(updates[index].endsWith(' ')).toBe(true)
    }
    probe.unmount()
    expect(frames.size).toBe(0)
  })

  it.each(['The end.', 'word '.repeat(200), 'word '.repeat(10000)])(
    'finishes buffered text over one horizon without snapping or a slow last word',
    (content) => {
      const probe = renderSmoothText({ content: '', isStreaming: true })
      probe.rerender({ content })
      advance(50)
      const before = probe.value()
      probe.rerender({ isStreaming: false })
      expect(probe.value()).toBe(before)
      advance(100)
      expect(probe.value().length).toBeLessThan(content.length)
      advance(320)
      expect(probe.value()).toBe(content)
      probe.unmount()
    }
  )

  it('does not bank a background-tab pause as reveal time', () => {
    const probe = renderSmoothText({ content: '', isStreaming: true })
    const content = 'word '.repeat(1000)
    probe.rerender({ content, isStreaming: false })
    frame(30_000)
    expect(probe.value().length).toBeGreaterThan(0)
    expect(probe.value().length).toBeLessThan(content.length)
    advance(320)
    expect(probe.value()).toBe(content)
    probe.unmount()
  })
})

describe('snapAllSmoothText — user Stop must end the paced reveal instantly', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reveals the full backlog immediately when snapped mid-stream', () => {
    const probe = renderSmoothText({ content: '', isStreaming: true })
    probe.rerender({ content: 'The quick brown fox jumps over the lazy dog. '.repeat(4) })
    // Paced reveal has not caught up (fake timers hold the frame loop).
    expect(probe.value().length).toBeLessThan(180)

    act(() => {
      snapAllSmoothText()
    })
    expect(probe.value()).toBe('The quick brown fox jumps over the lazy dog. '.repeat(4))
    probe.unmount()
  })

  it('is one-shot: a later stream paces normally again', () => {
    const probe = renderSmoothText({ content: '', isStreaming: true })
    act(() => {
      snapAllSmoothText()
    })
    probe.rerender({
      content: 'Fresh streaming text that should reveal gradually, not snap. '.repeat(3),
    })
    expect(probe.value().length).toBeLessThan(180)
    probe.unmount()
  })
})
