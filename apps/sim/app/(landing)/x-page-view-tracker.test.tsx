/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { navigation, mockTwq } = vi.hoisted(() => ({
  navigation: { pathname: '/pricing' },
  mockTwq: vi.fn(),
}))

vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }))

import { XPageViewTracker } from '@/app/(landing)/x-page-view-tracker'

let root: Root | null = null

function render(): void {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  if (!root) root = createRoot(document.createElement('div'))
  act(() => root?.render(<XPageViewTracker />))
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  navigation.pathname = '/pricing'
  window.twq = undefined
  vi.clearAllMocks()
})

describe('XPageViewTracker', () => {
  it('skips the pixel automatic first view and tracks later path changes once', () => {
    window.twq = mockTwq
    render()
    expect(mockTwq).not.toHaveBeenCalled()

    navigation.pathname = '/demo'
    render()
    render()

    expect(mockTwq).toHaveBeenCalledOnce()
    expect(mockTwq).toHaveBeenCalledWith('config', 'q5xbl')
  })
})
