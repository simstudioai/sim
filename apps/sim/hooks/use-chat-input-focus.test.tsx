/** @vitest-environment jsdom */
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatInputFocus } from '@/hooks/use-chat-input-focus'

function ChatInput() {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useChatInputFocus({ textareaRef })
  return <textarea ref={textareaRef} />
}

describe('useChatInputFocus', () => {
  let container: HTMLDivElement
  let root: Root
  let activeWindow: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    activeWindow = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function flushFocus() {
    act(() => vi.advanceTimersToNextFrame())
  }

  it('focuses the newly mounted composer after navigation from the sidebar', () => {
    const link = document.createElement('a')
    link.href = '#chat'
    container.appendChild(link)
    link.focus()
    act(() => root.render(<ChatInput />))
    flushFocus()
    expect(document.activeElement).toBe(container.querySelector('textarea'))
  })

  it.each(['input', 'textarea', 'select', 'contenteditable'])(
    'preserves focus in another %s',
    (kind) => {
      const field = document.createElement(kind === 'contenteditable' ? 'div' : kind)
      if (kind === 'contenteditable') {
        field.setAttribute('contenteditable', 'true')
        field.tabIndex = 0
        Object.defineProperty(field, 'isContentEditable', { value: true })
      }
      document.body.appendChild(field)
      try {
        act(() => root.render(<ChatInput />))
        field.focus()
        flushFocus()
        expect(document.activeElement).toBe(field)
      } finally {
        field.remove()
      }
    }
  )

  it('does not focus a composer in an inactive window', () => {
    activeWindow.mockReturnValue(false)
    act(() => root.render(<ChatInput />))
    flushFocus()
    expect(document.activeElement).not.toBe(container.querySelector('textarea'))
  })

  it('does not refocus or move the caret on ordinary rerenders', () => {
    act(() => root.render(<ChatInput />))
    flushFocus()
    const textarea = container.querySelector('textarea')!
    textarea.value = 'Draft question'
    textarea.setSelectionRange(2, 5)
    const focus = vi.spyOn(textarea, 'focus')
    act(() => root.render(<ChatInput />))
    flushFocus()
    expect(focus).not.toHaveBeenCalled()
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 5])
  })

  it('cancels the previous composer focus during rapid chat switches', () => {
    act(() => root.render(<ChatInput key='chat-a' />))
    const previous = container.querySelector('textarea')!
    const focus = vi.spyOn(previous, 'focus')
    act(() => root.render(<ChatInput key='chat-b' />))
    flushFocus()
    expect(focus).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(container.querySelector('textarea'))
    expect(document.activeElement).not.toBe(previous)
  })

  it('cancels focus when the composer unmounts before the frame', () => {
    act(() => root.render(<ChatInput />))
    const focus = vi.spyOn(container.querySelector('textarea')!, 'focus')
    act(() => root.render(null))
    flushFocus()
    expect(focus).not.toHaveBeenCalled()
  })
})
