/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/client', () => authClientMock)

import { useSessionExpiry } from '@/lib/auth/session-expiry'

const { mockUseSession } = authClientMockFns

const roots: Root[] = []

function sessionFor(userId: string | null) {
  return {
    data: userId ? { user: { id: userId }, session: {} } : null,
    isPending: false,
    error: null,
  }
}

function mountWatching(recover: () => Promise<boolean>, leaveForNewUser: () => Promise<void>) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  function Probe() {
    useSessionExpiry(recover, leaveForNewUser)
    return null
  }
  const render = () => act(() => root.render(<Probe />))
  render()
  return render
}

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount()
  })
})

describe('useSessionExpiry', () => {
  it('leaves without signing out when another tab signs in as a different user', () => {
    const recover = vi.fn(async () => true)
    const leaveForNewUser = vi.fn(async () => {})
    mockUseSession.mockReturnValue(sessionFor('user-a'))
    const rerender = mountWatching(recover, leaveForNewUser)

    mockUseSession.mockReturnValue(sessionFor('user-b'))
    rerender()
    rerender()

    expect(leaveForNewUser).toHaveBeenCalledTimes(1)
    expect(recover).not.toHaveBeenCalled()
  })

  it('stays put while the same user’s session refreshes', () => {
    const recover = vi.fn(async () => true)
    const leaveForNewUser = vi.fn(async () => {})
    mockUseSession.mockReturnValue(sessionFor('user-a'))
    const rerender = mountWatching(recover, leaveForNewUser)

    mockUseSession.mockReturnValue(sessionFor('user-a'))
    rerender()

    expect(leaveForNewUser).not.toHaveBeenCalled()
    expect(recover).not.toHaveBeenCalled()
  })
})
