/**
 * @vitest-environment jsdom
 *
 * Failure mode: forking from a row with no stored id (the part of an answer before
 * a steered message, or a live answer) answers 400, so the action must not show.
 */
import { act } from 'react'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)

import { ToastProvider } from '@sim/emcn-legacy'
import { MessageActions } from '@/app/workspace/[workspaceId]/components/message-actions/message-actions'
import { ChatSurfaceProvider } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'

nextNavigationMockFns.mockUseParams.mockReturnValue({ workspaceId: 'workspace-1' })

const roots: Root[] = []

function forkButtonFor(messageId: string): Element | null {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      <ToastProvider>
        <QueryClientProvider client={new QueryClient()}>
          <ChatSurfaceProvider chatId='chat-1'>
            <MessageActions content='Answer' userQuery='Question' messageId={messageId} />
          </ChatSurfaceProvider>
        </QueryClientProvider>
      </ToastProvider>
    )
  })
  return container.querySelector("[aria-label='Fork in new chat']")
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
})

describe('MessageActions', () => {
  it('offers a fork from a stored message', () => {
    expect(forkButtonFor('answer-1')).not.toBeNull()
  })

  it('offers none from the part of an answer before a steered message', () => {
    expect(forkButtonFor('answer-1:before:steered-1')).toBeNull()
  })
})
