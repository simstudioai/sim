/** @vitest-environment jsdom */
import { act, type ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageContent } from '@/app/workspace/[workspaceId]/home/components/message-content/message-content'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: null, isPending: false }),
}))
vi.mock('@/hooks/use-smooth-text', () => ({ useSmoothText: (text: string) => text }))
vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-test' }),
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn() }),
}))

const QUESTION = `<question>${JSON.stringify([
  {
    type: 'single_select',
    prompt: 'Choose an account',
    options: [
      { id: 'personal', label: 'Personal account' },
      { id: 'team', label: 'Team account' },
    ],
  },
])}</question>`

function activity(id: string): ContentBlock {
  return {
    type: 'tool_call',
    spanId: 'main',
    toolCall: {
      id,
      name: 'read',
      status: 'success',
      params: { activity: { id, title: `Reading ${id}`, completedTitle: `Read ${id}` } },
    },
  }
}

function text(content: string): ContentBlock {
  return { type: 'text', content }
}

/**
 * These render tests protect the adjacency and card boundaries consumed by the
 * spacing selectors. Pixel gaps are checked in the browser; jsdom has no layout.
 */
describe('message activity and card boundaries', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient
  const onSelect = vi.fn()
  const onDismiss = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
    vi.clearAllMocks()
    queryClient = new QueryClient()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    queryClient.clear()
    vi.unstubAllGlobals()
  })

  async function render(
    blocks: ContentBlock[],
    props: Partial<ComponentProps<typeof MessageContent>> = {}
  ) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MessageContent
            blocks={blocks}
            fallbackContent=''
            isStreaming={false}
            onOptionSelect={onSelect}
            onQuestionDismiss={onDismiss}
            {...props}
          />
        </QueryClientProvider>
      )
    })
  }

  function activities() {
    return [...container.querySelectorAll<HTMLElement>('[data-chat-activity]')]
  }

  function card() {
    const element = container.querySelector<HTMLElement>('[data-interaction-card]')
    expect(element).not.toBeNull()
    return element!
  }

  function button(label: string) {
    const element = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (node) => node.textContent === label || node.getAttribute('aria-label') === label
    )
    expect(element).toBeDefined()
    return element!
  }

  it('keeps consecutive activity rows adjacent and prose on its own boundary', async () => {
    await render([
      text('Starting the review.'),
      activity('first'),
      activity('second'),
      text('Done.'),
    ])
    const [first, second] = activities()
    expect(activities()).toHaveLength(2)
    expect(first.nextElementSibling).toBe(second)
    expect(first.previousElementSibling?.textContent).toBe('Starting the review.')
    expect(second.nextElementSibling?.textContent).toBe('Done.')
    expect(first.parentElement).toBe(second.parentElement)
    expect(first.previousElementSibling?.hasAttribute('data-chat-activity')).toBe(false)
    expect(second.nextElementSibling?.hasAttribute('data-chat-activity')).toBe(false)
  })

  it.each(['active', 'answered'] as const)(
    'keeps a rehydrated %s card between the same activity boundaries',
    async (state) => {
      await render([activity('first'), text(QUESTION), activity('second')], {
        questionAnswers: state === 'answered' ? ['Personal account'] : undefined,
      })
      const [first, second] = activities()
      const cardRoot = card().parentElement!
      expect(first.nextElementSibling).toBe(cardRoot)
      expect(cardRoot.nextElementSibling).toBe(second)
      expect(cardRoot.lastElementChild).toBe(card())
      expect(cardRoot.children).toHaveLength(1)
      expect(card().textContent).toContain('Choose an account')
      expect(card().querySelector('input') !== null).toBe(state === 'active')
    }
  )

  it('answers in place without remounting adjacent tool activity', async () => {
    await render([activity('first'), text(QUESTION), activity('second')])
    const [first, second] = activities()
    const cardRoot = card().parentElement!
    act(() => button('Personal account').click())
    expect(onSelect).toHaveBeenCalledWith('Choose an account — Personal account')
    expect(card().textContent).toContain('Personal account')
    expect(card().querySelector('input')).toBeNull()
    expect(card().parentElement).toBe(cardRoot)
    expect(activities()[0]).toBe(first)
    expect(activities()[1]).toBe(second)
    expect(first.nextElementSibling).toBe(cardRoot)
    expect(cardRoot.nextElementSibling).toBe(second)
  })

  it('leaves only an empty boundary when a card between activities is dismissed', async () => {
    await render([activity('first'), text(QUESTION), activity('second')])
    const [first, second] = activities()
    const cardRoot = card().parentElement!
    act(() => button('Dismiss').click())
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(container.querySelector('[data-interaction-card]')).toBeNull()
    expect(cardRoot.matches(':empty')).toBe(true)
    expect(first.nextElementSibling).toBe(cardRoot)
    expect(cardRoot.nextElementSibling).toBe(second)
    expect(activities()[0]).toBe(first)
    expect(activities()[1]).toBe(second)
  })

  it('keeps the terminal action region outside the empty dismissed-card boundary', async () => {
    await render([activity('first'), text(QUESTION)], {
      actions: <button type='button'>Copy</button>,
    })
    const first = activities()[0]
    const cardRoot = card().parentElement!
    const actionRegion = button('Copy').parentElement!.parentElement!
    const stack = first.parentElement!
    expect(stack.nextElementSibling).toBe(actionRegion)
    act(() => button('Dismiss').click())
    expect(cardRoot.matches(':empty')).toBe(true)
    expect(cardRoot.nextElementSibling).toBeNull()
    expect(first.nextElementSibling).toBe(cardRoot)
    expect(stack.nextElementSibling).toBe(actionRegion)
    expect(stack.contains(button('Copy'))).toBe(false)
  })

  it('keeps a trailing activity recap on the card boundary before the next activity', async () => {
    const takeover: ContentBlock = {
      type: 'tool_call',
      spanId: 'main',
      toolCall: {
        id: 'takeover',
        name: 'browser_request_takeover',
        status: 'success',
        params: { reason: 'Review the browser step' },
        result: { success: true, output: { userInstruction: 'Continue' } },
      },
    }
    await render([activity('first'), takeover, activity('second')])
    const [first, second] = activities()
    expect(first.nextElementSibling).toBe(second)
    expect(first.lastElementChild?.lastElementChild?.lastElementChild).toBe(card())
    expect(card().nextElementSibling).toBeNull()
  })

  it('does not treat a card followed by prose as the final content of its segment', async () => {
    await render([text(`${QUESTION}\n\nThe draft is ready.`), activity('next')])
    const cardRoot = card().parentElement!
    expect(cardRoot.lastElementChild).not.toBe(card())
    expect(cardRoot.lastElementChild?.textContent).toBe('The draft is ready.')
    expect(cardRoot.nextElementSibling).toBe(activities()[0])
  })
})
