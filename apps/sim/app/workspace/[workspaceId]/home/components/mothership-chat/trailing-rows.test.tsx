/**
 * @vitest-environment jsdom
 *
 * Messages on their way into a turn, or shown as not delivered, render after its answer. Failure
 * modes: the running answer loses its thinking indicator because a steered message trails it (an
 * empty one disappears altogether); the last answer's choices stop responding because a message
 * not delivered trails it; a real next message leaves the old answer's choices live.
 */
import { act } from 'react'
import { integrationMatcherMock } from '@sim/testing/mocks/integration-matcher.mock'
import { libDesktopMock } from '@sim/testing/mocks/lib-desktop.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeatureFlagsProvider } from '@/lib/core/config/feature-flags-context'
import type { ChatMessage } from '@/lib/mothership/chat/types'
import { MothershipChat } from '@/app/workspace/[workspaceId]/home/components/mothership-chat/mothership-chat'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/desktop', () => libDesktopMock)
vi.mock('@/blocks/integration-matcher', () => integrationMatcherMock)

const owner: ChatMessage = { id: 'turn', role: 'user', content: 'Count' }
const steered: ChatMessage = {
  id: 'steer',
  role: 'user',
  content: 'Stop at two',
  steering: { streamId: 'turn' },
  delivery: 'sending',
}
const notDelivered: ChatMessage = {
  id: 'failed',
  role: 'user',
  content: 'Then summarize',
  delivery: 'failed',
}
const choices: ChatMessage = {
  id: 'answer',
  role: 'assistant',
  content: '',
  contentBlocks: [{ type: 'options', options: [{ id: '1', label: 'Pick this one' }] }],
}

let root: Root
let container: HTMLDivElement
let client: QueryClient
const onSubmit = vi.fn()

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  /* The virtualizer renders nothing into a viewport with no size. */
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(2_000)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
  onSubmit.mockReset()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
})

async function renderChat(messages: ChatMessage[], isSending: boolean) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <FeatureFlagsProvider
          flags={{
            dashboards: false,
            'workflow-tests': false,
            changelog: false,
            'mothership-model-selector': false,
            'mothership-plan-mode': false,
            'mothership-computer-use': false,
          }}
        >
          <MothershipChat
            messages={messages}
            isSending={isSending}
            onSubmit={onSubmit}
            onStopGeneration={vi.fn()}
            composer={<div />}
          />
        </FeatureFlagsProvider>
      </QueryClientProvider>
    )
  )
}

function findOption(): HTMLElement {
  const option = [...container.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Pick this one')
  )
  if (!option) throw new Error('The answer rendered no choice')
  return option
}

describe('rows trailing an answer', () => {
  it('keeps the thinking indicator on a running answer a steered message trails', async () => {
    await renderChat(
      [owner, { id: 'live', role: 'assistant', content: '', contentBlocks: [] }, steered],
      true
    )
    expect(container.textContent).toContain('Stop at two')
    expect(container.textContent).toContain('Thinking')
  })

  it('keeps the last answer’s choices live under a message shown as not delivered', async () => {
    await renderChat([owner, choices, notDelivered], false)
    await act(async () => findOption().click())
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('leaves an answer’s choices dead once a real next message follows it', async () => {
    await renderChat(
      [owner, choices, { id: 'next', role: 'user', content: 'Something else' }],
      false
    )
    await act(async () => findOption().click())
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
