/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { PersistedMessage } from '@/lib/mothership/chat/persisted-message'
import { compactRetrievalCitations } from '@/lib/mothership/chat/retrieval-citations'
import { SourcesResourceContent } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/sources-resource-content'
import { type MothershipChatHistory, mothershipChatKeys } from '@/hooks/queries/mothership-chats'

it('renders cited cached evidence, follows the latest answer, and never reruns provider searches', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  const root = createRoot(container)
  const citationId = `document:live:${'x'.repeat(700)}`
  const message: PersistedMessage = {
    id: 'persisted-answer',
    requestId: 'run-1',
    role: 'assistant',
    requestMode: 'assistant',
    timestamp: '2026-09-22T00:00:00Z',
    content: `Answer <source>{"id":"${citationId}"}</source>`,
    contentBlocks: [
      {
        type: 'tool',
        toolCall: {
          id: 'search',
          name: 'search_workspace',
          state: 'success',
          result: {
            success: true,
            output: compactRetrievalCitations('search_workspace', {
              success: true,
              data: {
                results: [
                  {
                    citationId,
                    citationUrl: 'https://sim.slack.com/archives/G1/p123',
                    documentName: 'Group DM · Sid, Waleed',
                    connectorType: 'slack',
                    author: 'Vikhyath Mondreti',
                    content: '@Vikhyath Mondreti Please review the release notes.',
                  },
                  {
                    citationId: 'unused',
                    citationUrl: 'https://unused.test',
                    documentName: 'Unused result',
                  },
                ],
              },
            }),
          },
        },
      },
    ],
  }
  client.setQueryData<MothershipChatHistory>(mothershipChatKeys.detail('chat'), {
    id: 'chat',
    title: 'Chat',
    messages: [
      message,
      {
        ...message,
        id: 'second-answer',
        requestId: 'run-2',
        content: '<source>{"id":"unused"}</source>',
      },
    ],
    activeStreamId: null,
    resources: [],
  })
  const render = (requestId: string) =>
    root.render(
      <QueryClientProvider client={client}>
        <SourcesResourceContent
          chatId='chat'
          resource={{
            type: 'sources',
            id: 'cited-sources',
            title: 'Sources',
            sources: { messageId: 'optimistic-answer', requestId },
          }}
        />
      </QueryClientProvider>
    )
  try {
    await act(async () => render('run-1'))
    expect(container.textContent).toContain('Sources · 1')
    expect(container.textContent).toContain('Group DM · Sid, Waleed')
    expect(container.textContent).not.toContain('Unused result')
    expect(container.querySelector('a')?.href).toBe('https://sim.slack.com/archives/G1/p123')
    await act(async () => render('run-2'))
    expect(container.textContent).toContain('Unused result')
    expect(container.textContent).not.toContain('Group DM')
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    client.clear()
    vi.unstubAllGlobals()
  }
})
