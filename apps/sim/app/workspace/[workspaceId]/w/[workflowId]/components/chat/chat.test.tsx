/** @vitest-environment jsdom */

import { act } from 'react'
import { authClientMock } from '@sim/testing/mocks/auth-client.mock'
import { providersModelsMock } from '@sim/testing/mocks/providers-models.mock'
import { providersUtilsMock } from '@sim/testing/mocks/providers-utils.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Chat } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/chat'
import { useChatStore } from '@/stores/chat/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

vi.mock('@/lib/auth/auth-client', () => authClientMock)
vi.mock('@/providers/models', () => providersModelsMock)
vi.mock('@/providers/utils', () => providersUtilsMock)
vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution', () => ({
  useWorkflowExecution: () => ({ handleRunWorkflow: vi.fn(), handleCancelExecution: vi.fn() }),
  isChatWorkflowRunResult: () => false,
  WorkflowAttachmentUploadError: class extends Error {},
}))
vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/components', () => ({
  ChatMessage: () => null,
  OutputSelect: () => null,
}))
vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/hooks/float', () => ({
  useFloatDrag: () => ({}),
  useFloatBoundarySync: () => {},
  useFloatResize: () => ({}),
}))

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  useChatStore.setState({ ...useChatStore.getInitialState(), isChatOpen: true })
  useWorkflowRegistry.setState({ activeWorkflowId: 'workflow-a' })
  useChatStore.getState().addMessage({ workflowId: 'workflow-a', type: 'user', content: 'first' })
  useChatStore.getState().addMessage({ workflowId: 'workflow-a', type: 'user', content: 'second' })
  useChatStore.getState().addMessage({
    workflowId: 'workflow-a',
    type: 'workflow',
    content: 'partial',
    isStreaming: true,
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<Chat />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  useChatStore.setState(useChatStore.getInitialState())
  useWorkflowRegistry.setState({ activeWorkflowId: null })
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
  vi.useRealTimers()
})

function input() {
  const element = container.querySelector<HTMLInputElement>(
    'input[placeholder="Type a message..."]'
  )
  if (!element) throw new Error('Chat composer missing')
  return element
}

function press(key: string) {
  act(() => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

describe('floating chat prompt history', () => {
  it('keeps the history cursor while assistant output streams and finalizes', () => {
    press('ArrowUp')
    expect(input().value).toBe('second')
    const responseId = useChatStore.getState().messages[2].id
    act(() => useChatStore.getState().setMessageContent(responseId, 'next chunk'))
    press('ArrowUp')
    expect(input().value).toBe('first')
    act(() => useChatStore.getState().finalizeMessageStream(responseId))
    press('ArrowDown')
    expect(input().value).toBe('second')
    press('ArrowDown')
    expect(input().value).toBe('')
  })

  it('resets navigation when the workflow changes even with identical prompt history', () => {
    act(() => {
      useChatStore
        .getState()
        .addMessage({ workflowId: 'workflow-b', type: 'user', content: 'first' })
      useChatStore
        .getState()
        .addMessage({ workflowId: 'workflow-b', type: 'user', content: 'second' })
    })
    press('ArrowUp')
    expect(input().value).toBe('second')
    act(() => useWorkflowRegistry.setState({ activeWorkflowId: 'workflow-b' }))
    press('ArrowUp')
    expect(input().value).toBe('second')
    act(() =>
      useChatStore
        .getState()
        .addMessage({ workflowId: 'workflow-b', type: 'user', content: 'newest' })
    )
    press('ArrowUp')
    expect(input().value).toBe('newest')
    act(() => useChatStore.getState().clearChat('workflow-b'))
    press('ArrowDown')
    expect(input().value).toBe('newest')
  })
})
