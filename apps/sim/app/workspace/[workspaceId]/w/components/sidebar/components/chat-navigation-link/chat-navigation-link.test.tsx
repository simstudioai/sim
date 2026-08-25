/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { linkPrefetch } = vi.hoisted(() => ({
  linkPrefetch: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    prefetch,
    ...props
  }: {
    href: string
    children: React.ReactNode
    prefetch?: boolean
  }) => {
    linkPrefetch(prefetch)
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

import { ChatNavigationLink } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/chat-navigation-link/chat-navigation-link'

describe('ChatNavigationLink', () => {
  let container: HTMLDivElement
  let queryClient: QueryClient
  let root: Root
  let prefetchQuery: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    linkPrefetch.mockReset()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    prefetchQuery = vi.spyOn(queryClient, 'prefetchQuery').mockResolvedValue()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    queryClient.clear()
    vi.useRealTimers()
  })

  function renderLink(chatId = 'chat-1', isCurrentRoute = false) {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ChatNavigationLink
            chatId={chatId}
            href={`/workspace/ws-1/chat/${chatId}`}
            isCurrentRoute={isCurrentRoute}
          >
            Open chat
          </ChatNavigationLink>
        </QueryClientProvider>
      )
    })
    const link = container.querySelector('a')
    if (!link) throw new Error('chat link not rendered')
    return link
  }

  function pointerEvent(type: string, pointerType: 'mouse' | 'touch', init?: MouseEventInit) {
    const event = new MouseEvent(type, { bubbles: true, ...init })
    Object.defineProperty(event, 'pointerType', { value: pointerType })
    return event
  }

  it('prefetches the route and exact history after deliberate pointer intent', () => {
    const link = renderLink()

    act(() => {
      link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      vi.advanceTimersByTime(79)
    })
    expect(linkPrefetch).toHaveBeenLastCalledWith(false)
    expect(prefetchQuery).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1))

    expect(linkPrefetch).toHaveBeenLastCalledWith(true)
    expect(prefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['mothership-chats', 'detail', 'chat-1'],
        staleTime: 30_000,
      })
    )

    act(() => link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))

    expect(linkPrefetch).toHaveBeenLastCalledWith(false)
    expect(prefetchQuery).toHaveBeenCalledTimes(1)
  })

  it('cancels drive-by hover prefetches', () => {
    const link = renderLink()

    act(() => {
      link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
      vi.runAllTimers()
    })

    expect(linkPrefetch).toHaveBeenLastCalledWith(false)
    expect(prefetchQuery).not.toHaveBeenCalled()
  })

  it('prefetches immediately for keyboard focus without fetching a new-chat history', () => {
    const link = renderLink('new')

    act(() => link.dispatchEvent(new FocusEvent('focusin', { bubbles: true })))

    expect(linkPrefetch).toHaveBeenLastCalledWith(true)
    expect(prefetchQuery).not.toHaveBeenCalled()
  })

  it('does not treat touch scrolling as navigation intent', () => {
    const link = renderLink()

    act(() => link.dispatchEvent(new TouchEvent('touchstart', { bubbles: true })))

    expect(linkPrefetch).toHaveBeenLastCalledWith(false)
    expect(prefetchQuery).not.toHaveBeenCalled()
  })

  it('prefetches before direct mouse clicks and completed touch taps', () => {
    const link = renderLink()
    linkPrefetch.mockClear()

    act(() => {
      link.dispatchEvent(pointerEvent('pointerdown', 'mouse', { button: 0 }))
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(linkPrefetch).toHaveBeenLastCalledWith(true)
    expect(prefetchQuery).toHaveBeenCalledTimes(1)

    act(() => link.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    linkPrefetch.mockClear()
    prefetchQuery.mockClear()
    act(() => {
      link.dispatchEvent(pointerEvent('pointerup', 'touch', { button: 0 }))
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(linkPrefetch).toHaveBeenLastCalledWith(true)
    expect(prefetchQuery).toHaveBeenCalledTimes(1)
  })

  it('cancels touch-scroll pointer intent before it can prefetch', () => {
    const link = renderLink()

    act(() => {
      link.dispatchEvent(pointerEvent('pointerdown', 'touch', { button: 0 }))
      link.dispatchEvent(pointerEvent('pointercancel', 'touch', { button: 0 }))
    })

    expect(linkPrefetch).toHaveBeenLastCalledWith(false)
    expect(prefetchQuery).not.toHaveBeenCalled()
  })

  it('does not prefetch when a nested chat action is pressed', () => {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ChatNavigationLink chatId='chat-1' href='/workspace/ws-1/chat/chat-1'>
            <button type='button' onClick={(event) => event.preventDefault()}>
              Chat options
            </button>
          </ChatNavigationLink>
        </QueryClientProvider>
      )
    })
    const button = container.querySelector('button')
    if (!button) throw new Error('chat action not rendered')

    act(() => {
      button.dispatchEvent(pointerEvent('pointerdown', 'mouse', { button: 0 }))
      button.dispatchEvent(pointerEvent('pointerup', 'touch', { button: 0 }))
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(linkPrefetch).toHaveBeenLastCalledWith(false)
    expect(prefetchQuery).not.toHaveBeenCalled()
  })

  it('does not prefetch the chat that is already open', () => {
    const link = renderLink('chat-1', true)

    act(() => link.dispatchEvent(new FocusEvent('focusin', { bubbles: true })))

    expect(linkPrefetch).toHaveBeenLastCalledWith(false)
    expect(prefetchQuery).not.toHaveBeenCalled()
  })

  it('clears prior intent when a persistent row changes route roles', () => {
    const renderRouteRole = (isCurrentRoute: boolean) => {
      act(() => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <ChatNavigationLink
              chatId='chat-1'
              href='/workspace/ws-1/chat/chat-1'
              isCurrentRoute={isCurrentRoute}
            >
              Open chat
            </ChatNavigationLink>
          </QueryClientProvider>
        )
      })
    }

    renderRouteRole(false)
    const link = container.querySelector('a')
    if (!link) throw new Error('chat link not rendered')
    act(() => {
      link.dispatchEvent(pointerEvent('pointerdown', 'mouse', { button: 0 }))
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(linkPrefetch).toHaveBeenLastCalledWith(true)

    renderRouteRole(true)
    renderRouteRole(false)

    expect(linkPrefetch).toHaveBeenLastCalledWith(false)
    prefetchQuery.mockClear()
    const destinationLink = container.querySelector('a')
    if (!destinationLink) throw new Error('destination link not rendered')
    act(() => {
      destinationLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(prefetchQuery).toHaveBeenCalledTimes(1)
  })

  it('does not prefetch when the click is canceled or opens another browsing context', () => {
    const canceledLink = renderLink()

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ChatNavigationLink
            chatId='chat-1'
            href='/workspace/ws-1/chat/chat-1'
            onClick={(event) => event.preventDefault()}
          >
            Open chat
          </ChatNavigationLink>
        </QueryClientProvider>
      )
    })
    act(() => {
      canceledLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(linkPrefetch).toHaveBeenLastCalledWith(false)
    expect(prefetchQuery).not.toHaveBeenCalled()

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ChatNavigationLink chatId='chat-1' href='/workspace/ws-1/chat/chat-1'>
            Open chat
          </ChatNavigationLink>
        </QueryClientProvider>
      )
    })
    const modifiedLink = container.querySelector('a')
    if (!modifiedLink) throw new Error('chat link not rendered')
    act(() => {
      modifiedLink.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
      )
    })

    expect(linkPrefetch).toHaveBeenLastCalledWith(false)
    expect(prefetchQuery).not.toHaveBeenCalled()
  })
})
