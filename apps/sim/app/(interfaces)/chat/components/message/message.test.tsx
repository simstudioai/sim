/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  Button: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  Duplicate: () => null,
  Tooltip: {
    Provider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Root: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Trigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Content: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  },
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/app/(interfaces)/chat/components/message/components/file-download', () => ({
  ChatFileDownload: () => null,
  ChatFileDownloadAll: () => null,
}))

vi.mock('@/app/(interfaces)/chat/components/message/components/markdown-renderer', () => ({
  default: ({ content }: { content: string }) => <div data-testid='answer'>{content}</div>,
}))

import {
  type ChatMessage,
  ClientChatMessage,
  escapeHtml,
} from '@/app/(interfaces)/chat/components/message/message'

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('neutralizes a markup-breakout filename payload', () => {
    const payload = '</title><img src=x onerror=alert(document.origin)>'
    const escaped = escapeHtml(payload)
    expect(escaped).not.toContain('<img')
    expect(escaped).not.toContain('</title>')
    expect(escaped).toBe('&lt;/title&gt;&lt;img src=x onerror=alert(document.origin)&gt;')
  })

  it('escapes ampersands first so entities are not double-broken', () => {
    expect(escapeHtml('a & b < c')).toBe('a &amp; b &lt; c')
  })

  it('leaves safe strings untouched', () => {
    expect(escapeHtml('report-2026.pdf')).toBe('report-2026.pdf')
    expect(escapeHtml('')).toBe('')
  })
})

function renderMessage(message: ChatMessage): { container: HTMLDivElement; unmount: () => void } {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() => {
    root.render(<ClientChatMessage message={message} />)
  })
  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe('ClientChatMessage thinking chrome (Step 6)', () => {
  const mounts: Array<() => void> = []

  afterEach(() => {
    while (mounts.length) {
      mounts.pop()?.()
    }
  })

  it('does not show thinking chrome when thinking is absent or empty', () => {
    const without = renderMessage({
      id: '1',
      type: 'assistant',
      content: 'Hello',
      timestamp: new Date(),
    })
    mounts.push(without.unmount)
    expect(without.container.textContent).not.toContain('Thinking')

    const empty = renderMessage({
      id: '2',
      type: 'assistant',
      content: 'Hello',
      thinking: '',
      timestamp: new Date(),
    })
    mounts.push(empty.unmount)
    expect(empty.container.textContent).not.toContain('Thinking')
  })

  it('shows collapsible thinking chrome above the answer after first thinking', () => {
    const { container, unmount } = renderMessage({
      id: '3',
      type: 'assistant',
      content: 'Answer text',
      thinking: 'Internal reasoning',
      isThinkingStreaming: true,
      timestamp: new Date(),
    })
    mounts.push(unmount)

    expect(container.textContent).toContain('Thinking…')
    expect(container.textContent).toContain('Internal reasoning')
    expect(container.textContent).toContain('Answer text')
  })

  it('labels completed thinking as Thought for a moment', () => {
    const { container, unmount } = renderMessage({
      id: '4',
      type: 'assistant',
      content: 'Answer text',
      thinking: 'Internal reasoning',
      isThinkingStreaming: false,
      timestamp: new Date(),
    })
    mounts.push(unmount)

    expect(container.textContent).toContain('Thought for a moment')
    expect(container.textContent).toContain('Answer text')
  })
})

describe('ClientChatMessage tool chrome (Step 8)', () => {
  const mounts: Array<() => void> = []

  afterEach(() => {
    while (mounts.length) {
      mounts.pop()?.()
    }
  })

  it('does not show tool chrome when toolCalls are absent or empty', () => {
    const without = renderMessage({
      id: '1',
      type: 'assistant',
      content: 'Hello',
      timestamp: new Date(),
    })
    mounts.push(without.unmount)
    expect(without.container.textContent).not.toContain('Tools')
    expect(without.container.textContent).not.toContain('Using tools')

    const empty = renderMessage({
      id: '2',
      type: 'assistant',
      content: 'Hello',
      toolCalls: [],
      timestamp: new Date(),
    })
    mounts.push(empty.unmount)
    expect(empty.container.textContent).not.toContain('Tools')
  })

  it('shows humanized tool names only (no args) while tools are running', () => {
    const { container, unmount } = renderMessage({
      id: '3',
      type: 'assistant',
      content: 'Answer',
      isToolStreaming: true,
      toolCalls: [
        {
          key: 'agent-1:toolu_1',
          blockId: 'agent-1',
          id: 'toolu_1',
          name: 'http_request',
          displayName: 'Http Request',
          status: 'running',
        },
      ],
      timestamp: new Date(),
    })
    mounts.push(unmount)

    expect(container.textContent).toContain('Using tools…')
    expect(container.textContent).toContain('Http Request')
    expect(container.textContent).not.toContain('toolu_1')
    expect(container.textContent).not.toContain('args')
    expect(container.textContent).toContain('Answer')
  })
})
