/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Range } from '@tanstack/react-virtual'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { ChatMessage } from '@/app/workspace/[workspaceId]/home/types'

const { scrollToIndex, renderMessage, renderInput } = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
  renderMessage: vi.fn(),
  renderInput: vi.fn(),
}))

/** The measured range still covers the old turn while appended rows await measurement. */
vi.mock('@tanstack/react-virtual', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-virtual')>()
  return {
    ...actual,
    useVirtualizer: (options: {
      count: number
      overscan: number
      rangeExtractor: (range: Range) => number[]
      getItemKey: (index: number) => string
    }) => ({
      getVirtualItems: () =>
        options
          .rangeExtractor({
            startIndex: 0,
            endIndex: 1,
            overscan: options.overscan,
            count: options.count,
          })
          .map((index) => ({ index, key: options.getItemKey(index), start: index * 100 })),
      getTotalSize: () => options.count * 100,
      scrollToIndex,
      measureElement: vi.fn(),
    }),
  }
})
vi.mock('@/app/workspace/[workspaceId]/components', () => ({ MessageActions: () => null }))
vi.mock('@/app/workspace/[workspaceId]/home/components/user-input', () => ({
  UserInput: (props: { onSendQueuedHead: () => void }) => {
    renderInput(props)
    return null
  },
}))
vi.mock('@/app/workspace/[workspaceId]/home/components/queued-messages', () => ({
  QueuedMessages: () => null,
}))
vi.mock('@/app/workspace/[workspaceId]/home/components/user-message-content', () => ({
  UserMessageContent: ({ content }: { content: string }) => <span>{content}</span>,
}))
vi.mock('@/app/workspace/[workspaceId]/home/components/message-content', () => ({
  assistantMessageHasRenderableContent: () => true,
  getOrchestratorMessageText: (_blocks: unknown, content: string) => content,
  MessageContent: ({
    fallbackContent,
    isStreaming,
  }: {
    fallbackContent: string
    isStreaming: boolean
  }) => {
    renderMessage(fallbackContent, isStreaming)
    return <span>{fallbackContent || (isStreaming ? 'Thinking' : '')}</span>
  },
}))
vi.mock('@/hooks/use-auto-scroll', () => ({ useAutoScroll: () => ({ ref: () => {} }) }))

import { MothershipChat } from './mothership-chat'

it('keeps the latest user beside Thinking while the virtual range covers the preceding turn', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  const container = document.createElement('div')
  const root = createRoot(container)
  const client = new QueryClient()
  const oldMessages: ChatMessage[] = [
    { id: 'old-user', role: 'user', content: 'Earlier question' },
    { id: 'old-answer', role: 'assistant', content: 'Earlier answer' },
    ...Array.from(
      { length: 8 },
      (_, index): ChatMessage => ({
        id: `middle-${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `Earlier turn ${index}`,
      })
    ),
  ]
  const render = (messages: ChatMessage[], isSending: boolean) =>
    root.render(
      <QueryClientProvider client={client}>
        <MothershipChat
          messages={messages}
          isSending={isSending}
          composer={<div />}
          onSubmit={vi.fn()}
        />
      </QueryClientProvider>
    )
  try {
    await act(async () => render(oldMessages, false))
    await act(async () =>
      render(
        [
          ...oldMessages,
          { id: 'new-user', role: 'user', content: 'Which release did I just ask about?' },
          { id: 'new-answer', role: 'assistant', content: '' },
        ],
        true
      )
    )
    expect(container.textContent).toContain('Earlier answer')
    expect(container.textContent).toContain('Thinking')
    expect(container.textContent).toContain('Which release did I just ask about?')
  } finally {
    await act(async () => root.unmount())
    client.clear()
    vi.unstubAllGlobals()
  }
})

it('waits for resource layout before landing on an existing chat, then scrolls for an own send', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  scrollToIndex.mockClear()
  const container = document.createElement('div')
  const root = createRoot(container)
  const client = new QueryClient()
  const history: ChatMessage[] = [
    { id: 'saved-user', role: 'user', content: 'Saved question' },
    { id: 'saved-answer', role: 'assistant', content: 'Saved answer' },
  ]
  const render = (messages: ChatMessage[], blocked: boolean, sending = false) =>
    root.render(
      <QueryClientProvider client={client}>
        <MothershipChat
          chatId='saved-chat'
          messages={messages}
          isSending={sending}
          initialScrollBlocked={blocked}
          composer={<div />}
          onSubmit={vi.fn()}
        />
      </QueryClientProvider>
    )
  try {
    await act(async () => render([], true))
    await act(async () => render(history, true))
    expect(container.textContent).toContain('Saved question')
    expect(scrollToIndex).not.toHaveBeenCalled()
    await act(async () => render(history, false))
    expect(scrollToIndex).toHaveBeenCalledTimes(1)
    expect(scrollToIndex).toHaveBeenLastCalledWith(1, { align: 'end' })
    scrollToIndex.mockClear()
    await act(async () =>
      render(
        [
          ...history,
          { id: 'new-user', role: 'user', content: 'Follow-up' },
          { id: 'new-answer', role: 'assistant', content: '' },
        ],
        false,
        true
      )
    )
    expect(scrollToIndex).toHaveBeenCalledTimes(1)
    expect(scrollToIndex).toHaveBeenLastCalledWith(3, { align: 'end' })
  } finally {
    await act(async () => root.unmount())
    client.clear()
    vi.unstubAllGlobals()
  }
})

it('never restarts the previous response while a new send waits for its deferred message list', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  const container = document.createElement('div')
  const root = createRoot(container)
  const client = new QueryClient()
  const history: ChatMessage[] = [
    { id: 'saved-user', role: 'user', content: 'Saved question' },
    { id: 'saved-answer', role: 'assistant', content: 'Saved answer' },
  ]
  const render = (messages: ChatMessage[], isSending: boolean) =>
    root.render(
      <QueryClientProvider client={client}>
        <MothershipChat
          chatId='saved-chat'
          messages={messages}
          isSending={isSending}
          composer={<div />}
          onSubmit={vi.fn()}
        />
      </QueryClientProvider>
    )
  try {
    await act(async () => render(history, false))
    renderMessage.mockClear()
    await act(async () =>
      render(
        [
          ...history,
          { id: 'next-user', role: 'user', content: 'Next question' },
          { id: 'next-answer', role: 'assistant', content: '' },
        ],
        true
      )
    )
    expect(renderMessage).not.toHaveBeenCalledWith('Saved answer', true)
    expect(renderMessage).toHaveBeenCalledWith('', true)
    expect(container.textContent).toContain('Next question')
  } finally {
    await act(async () => root.unmount())
    client.clear()
    vi.unstubAllGlobals()
  }
})

it('delegates empty Enter to the live queue sender before the rendered queue updates', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  const container = document.createElement('div')
  const root = createRoot(container)
  const client = new QueryClient()
  const sendNow = vi.fn().mockResolvedValue(undefined)
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MothershipChat
            messages={[]}
            isSending
            messageQueue={[]}
            onSubmit={vi.fn()}
            onStopGeneration={vi.fn()}
            onSendQueuedMessage={sendNow}
            editingQueuedId={null}
            dispatchingHeadId={null}
            onRemoveQueuedMessage={vi.fn()}
            onEditQueuedMessage={vi.fn()}
            onCancelQueueEdit={vi.fn()}
          />
        </QueryClientProvider>
      )
    )
    await act(async () => renderInput.mock.lastCall![0].onSendQueuedHead())
    expect(sendNow).toHaveBeenCalledExactlyOnceWith()
  } finally {
    await act(async () => root.unmount())
    client.clear()
    vi.unstubAllGlobals()
  }
})
