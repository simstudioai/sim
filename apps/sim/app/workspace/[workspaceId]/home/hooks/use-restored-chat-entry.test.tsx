/** @vitest-environment jsdom */

import { act, StrictMode } from 'react'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)

import { useRestoredChatEntry } from '@/app/workspace/[workspaceId]/home/hooks/use-restored-chat-entry'

interface SurfaceProps {
  chatId?: string
}

let isRestoredEntry: boolean | undefined
function Surface({ chatId }: SurfaceProps) {
  isRestoredEntry = useRestoredChatEntry({ chatId })
  return null
}

let root: Root
function at(url: string) {
  const { pathname, search } = new URL(url, 'http://localhost')
  nextNavigationMockFns.mockUsePathname.mockReturnValue(pathname)
  nextNavigationMockFns.mockUseSearchParams.mockReturnValue(new URLSearchParams(search))
}
function render(props: SurfaceProps = {}) {
  act(() =>
    root.render(
      <StrictMode>
        <Surface {...props} />
      </StrictMode>
    )
  )
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  isRestoredEntry = undefined
  root = createRoot(document.createElement('div'))
})

afterEach(() => {
  act(() => root.unmount())
})

describe('useRestoredChatEntry', () => {
  it('hands a new-chat surface restored at a chat URL to the router, query included', () => {
    at('/workspace/w/chat/c?resource=x')
    render()

    expect(isRestoredEntry).toBe(true)
    expect(nextNavigationMockFns.router.replace).toHaveBeenLastCalledWith(
      '/workspace/w/chat/c?resource=x',
      { scroll: false }
    )
  })

  it('keeps rendering the surface that moved its own URL to the chat during a turn', () => {
    at('/workspace/w/home')
    render()
    at('/workspace/w/chat/c')
    render()

    expect(isRestoredEntry).toBe(false)
    expect(nextNavigationMockFns.router.replace).not.toHaveBeenCalled()
  })

  it('leaves a chat surface and the home URL alone', () => {
    at('/workspace/w/chat/c')
    render({ chatId: 'c' })
    expect(isRestoredEntry).toBe(false)

    act(() => root.unmount())
    root = createRoot(document.createElement('div'))
    at('/o/o/home')
    render()
    expect(isRestoredEntry).toBe(false)

    expect(nextNavigationMockFns.router.replace).not.toHaveBeenCalled()
  })
})
