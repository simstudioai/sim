/**
 * @vitest-environment jsdom
 *
 * Chat find's contract: the tally counts MESSAGES (not occurrences), stepping
 * wraps and reveals, and the highlights painted into the global registry only
 * ever cover mounted rows — with the message being stepped on separated out.
 */
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@/app/workspace/[workspaceId]/home/types'
import { collectHighlightRanges, useChatFind } from './use-chat-find'

/**
 * jsdom ships neither `CSS.highlights` nor `Highlight`. The stub keeps the real
 * contract — a named registry of range sets — so the assertions below read the
 * same ranges the browser would paint.
 */
class HighlightStub extends Set<Range> {}

let registry: Map<string, HighlightStub>

function installHighlightRegistry() {
  registry = new Map()
  vi.stubGlobal('Highlight', HighlightStub)
  vi.stubGlobal('CSS', { highlights: registry })
}

function rangeTexts(name: string): string[] {
  return [...(registry.get(name) ?? [])].map((range) => range.toString())
}

function message(id: string, content: string, role: 'user' | 'assistant' = 'user'): ChatMessage {
  return { id, role, content, timestamp: '2026-01-01T00:00:00.000Z' } as ChatMessage
}

const reveal = vi.fn()

interface HarnessProps {
  messages: ChatMessage[]
  /** Indexes the virtualizer has mounted; the rows rendered below. */
  rendered: number[]
  onFind: (find: ReturnType<typeof useChatFind>) => void
}

function Harness({ messages, rendered, onFind }: HarnessProps) {
  const rowsRef = useRef<HTMLDivElement>(null)
  const find = useChatFind({
    messages,
    rowsRef,
    renderedItems: rendered.map((index) => ({ index })),
    revealMessage: reveal,
  })
  onFind(find)
  return (
    <div ref={rowsRef}>
      {rendered.map((index) => (
        <div key={index} data-index={index}>
          {messages[index].content}
        </div>
      ))}
    </div>
  )
}

let container: HTMLDivElement
let root: Root
let find: ReturnType<typeof useChatFind>

function render(messages: ChatMessage[], rendered: number[]) {
  act(() => {
    root.render(
      <Harness
        messages={messages}
        rendered={rendered}
        onFind={(next) => {
          find = next
        }}
      />
    )
  })
}

function pressFind(options: { defaultPrevented?: boolean } = {}) {
  act(() => {
    const event = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    if (options.defaultPrevented) event.preventDefault()
    document.dispatchEvent(event)
  })
}

function type(query: string) {
  act(() => find.setQuery(query))
}

beforeEach(() => {
  installHighlightRegistry()
  reveal.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('collectHighlightRanges', () => {
  it('finds every occurrence in a node, case-insensitively', () => {
    const root = document.createElement('div')
    root.textContent = 'Postgres, postgres and POSTGRES'
    const ranges = collectHighlightRanges(root, 'postgres')
    expect(ranges.map((range) => range.toString())).toEqual(['Postgres', 'postgres', 'POSTGRES'])
  })

  it('walks nested nodes and skips a term split across them', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>a <strong>post</strong>gres <em>postgres</em></p>'
    expect(collectHighlightRanges(root, 'postgres').map((r) => r.toString())).toEqual(['postgres'])
  })

  it('returns nothing for an empty term', () => {
    const root = document.createElement('div')
    root.textContent = 'postgres'
    expect(collectHighlightRanges(root, '')).toEqual([])
  })
})

describe('useChatFind', () => {
  const messages = [
    message('a', 'postgres postgres postgres'),
    message('b', 'nothing here', 'assistant'),
    message('c', 'one postgres'),
  ]

  it('opens on Cmd+F and ignores a press another surface already took', () => {
    render(messages, [0, 1, 2])
    expect(find.isOpen).toBe(false)

    pressFind({ defaultPrevented: true })
    expect(find.isOpen).toBe(false)

    pressFind()
    expect(find.isOpen).toBe(true)
  })

  it('counts matching messages, not occurrences, and reveals the first', () => {
    render(messages, [0, 1, 2])
    pressFind()
    type('postgres')

    // Message 'a' holds three occurrences; the tally still reads two matches.
    expect(find.matchCount).toBe(2)
    expect(find.activeIndex).toBe(0)
    expect(reveal).toHaveBeenLastCalledWith(0)
  })

  it('steps forward and backward with wrapping', () => {
    render(messages, [0, 1, 2])
    pressFind()
    type('postgres')

    act(() => find.goToNext())
    expect(find.activeIndex).toBe(1)
    expect(reveal).toHaveBeenLastCalledWith(2)

    act(() => find.goToNext())
    expect(find.activeIndex).toBe(0)
    expect(reveal).toHaveBeenLastCalledWith(0)

    act(() => find.goToPrev())
    expect(find.activeIndex).toBe(1)
    expect(reveal).toHaveBeenLastCalledWith(2)
  })

  it('paints every occurrence, holding the stepped-on message apart', () => {
    render(messages, [0, 1, 2])
    pressFind()
    type('postgres')

    // Active message is 'a' — its three occurrences carry the active highlight,
    // message 'c' the base one.
    expect(rangeTexts('sim-chat-find-active')).toHaveLength(3)
    expect(rangeTexts('sim-chat-find')).toEqual(['postgres'])

    act(() => find.goToNext())
    expect(rangeTexts('sim-chat-find-active')).toEqual(['postgres'])
    expect(rangeTexts('sim-chat-find')).toHaveLength(3)
  })

  it('paints only mounted rows', () => {
    render(messages, [2])
    pressFind()
    type('postgres')

    // Both messages match, but only row 2 is mounted, so only it is painted —
    // and it is not the active one, which the virtualizer has yet to reveal.
    expect(find.matchCount).toBe(2)
    expect(rangeTexts('sim-chat-find')).toEqual(['postgres'])
    expect(rangeTexts('sim-chat-find-active')).toEqual([])
  })

  it('clears the term and every highlight on close', () => {
    render(messages, [0, 1, 2])
    pressFind()
    type('postgres')
    expect(registry.get('sim-chat-find-active')?.size).toBeGreaterThan(0)

    act(() => find.close())
    expect(find.isOpen).toBe(false)
    expect(find.query).toBe('')
    expect(find.matchCount).toBe(0)
    expect(registry.has('sim-chat-find')).toBe(false)
    expect(registry.has('sim-chat-find-active')).toBe(false)
  })

  it('drops highlights when the surface unmounts', () => {
    render(messages, [0, 1, 2])
    pressFind()
    type('postgres')
    expect(registry.size).toBeGreaterThan(0)

    act(() => root.unmount())
    expect(registry.has('sim-chat-find')).toBe(false)
    expect(registry.has('sim-chat-find-active')).toBe(false)

    root = createRoot(container)
  })
})
