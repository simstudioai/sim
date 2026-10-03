/**
 * @vitest-environment jsdom
 */
import { act, useRef } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatContent } from '@/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/chat-content'
import { useChatFind } from '@/app/workspace/[workspaceId]/home/components/mothership-chat/use-chat-find'
import type { ChatMessage } from '@/app/workspace/[workspaceId]/home/types'

type ChatFind = ReturnType<typeof useChatFind>

interface HarnessProps {
  chatId?: string
  messages: ChatMessage[]
  onRender: (find: ChatFind) => void
}

// double-cast-allowed: the hook only calls scrollToIndex on the virtualizer
const virtualizer = { scrollToIndex: () => {} } as unknown as Virtualizer<HTMLDivElement, Element>

function Harness({ chatId, messages, onRender }: HarnessProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollElementRef = useRef<HTMLDivElement>(null)
  const find = useChatFind({
    chatId,
    messages,
    hiddenUserByIndex: [],
    containerRef,
    scrollElementRef,
    virtualizer,
  })
  onRender(find)
  return (
    <div ref={containerRef} tabIndex={-1} onKeyDown={find.onKeyDown}>
      <div ref={scrollElementRef}>
        {messages.map((message, index) => (
          <div
            key={message.id}
            data-index={index}
            dangerouslySetInnerHTML={{
              __html: renderToStaticMarkup(<ChatContent content={message.content} />),
            }}
          />
        ))}
      </div>
    </div>
  )
}

const cleanups: (() => void)[] = []

function renderFind(props: Omit<HarnessProps, 'onRender'>) {
  let find: ChatFind | undefined
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = (next: Omit<HarnessProps, 'onRender'>) =>
    act(() => root.render(<Harness {...next} onRender={(value) => (find = value)} />))
  cleanups.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  render(props)
  return {
    get current() {
      if (!find) throw new Error('Hook was not rendered')
      return find
    },
    rerender: render,
    search(query: string) {
      act(() => {
        host.firstElementChild?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true })
        )
      })
      act(() => find?.onQueryChange(query))
    },
  }
}

function assistant(id: string, content: string): ChatMessage {
  return { id, role: 'assistant', content }
}

class TestHighlight extends Set<Range> {}

beforeEach(() => {
  vi.stubGlobal('Highlight', TestHighlight)
  vi.stubGlobal('CSS', { highlights: new Map<string, TestHighlight>() })
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
})

describe('useChatFind', () => {
  it('keeps the open search when a pending chat is persisted, and resets on a chat switch', () => {
    const messages = [assistant('a', 'The answer is here.')]
    const find = renderFind({ messages })
    find.search('answer')
    expect(find.current).toMatchObject({ isOpen: true, query: 'answer', count: 1 })

    find.rerender({ chatId: 'chat-1', messages })
    expect(find.current).toMatchObject({ isOpen: true, query: 'answer', count: 1 })

    find.rerender({ chatId: 'chat-2', messages })
    expect(find.current).toMatchObject({ isOpen: false, query: '', count: 0 })
  })

  it('counts the same footnoted matches in the index as it highlights in the rendered message', async () => {
    const find = renderFind({
      chatId: 'chat',
      messages: [assistant('a', 'Chapter 1 cites this[^1].\n\n[^1]: Page 1.')],
    })
    find.search('1')
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

    const highlighted = CSS.highlights.get('chat-find')
    expect(find.current.count).toBe(1)
    expect(highlighted?.size).toBe(find.current.count)
  })
})
