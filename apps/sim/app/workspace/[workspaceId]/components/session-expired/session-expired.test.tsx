/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseSession, mockRecoverFromStaleSession } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockRecoverFromStaleSession: vi.fn(),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: mockUseSession,
}))

vi.mock('@/lib/auth/stale-session-recovery', () => ({
  recoverFromStaleSession: mockRecoverFromStaleSession,
}))

import { SessionExpired } from '@/app/workspace/[workspaceId]/components/session-expired/session-expired'

type SessionState = {
  data: unknown
  isPending?: boolean
  error?: Error | null
}

const LIVE: SessionState = { data: { user: { id: 'u1' } } }
const IMPERSONATED: SessionState = {
  data: { user: { id: 'u1' }, session: { impersonatedBy: 'admin-1' } },
}
const GONE: SessionState = { data: null }

let container: HTMLDivElement
let root: Root

function render(state: SessionState) {
  mockUseSession.mockReturnValue({
    data: state.data,
    isPending: state.isPending ?? false,
    error: state.error ?? null,
    refetch: vi.fn(),
  })
  act(() => {
    root.render(<SessionExpired />)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRecoverFromStaleSession.mockResolvedValue(true)
  container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    root = createRoot(container)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SessionExpired', () => {
  it('recovers when a live session settles to null', () => {
    render(LIVE)
    expect(mockRecoverFromStaleSession).not.toHaveBeenCalled()

    render(GONE)

    expect(mockRecoverFromStaleSession).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Your session expired')
  })

  it('stays inert for a visitor who never had a session', () => {
    render(GONE)

    expect(mockRecoverFromStaleSession).not.toHaveBeenCalled()
    expect(container.textContent).toBe('')
  })

  it('treats a failed session read as unknown, not as an expiry', () => {
    render(LIVE)
    // A 5xx or an offline blip must never read as "signed out" — the desktop
    // window that sleeps and wakes offline would otherwise be logged out.
    render({ data: null, error: new Error('offline') })

    expect(mockRecoverFromStaleSession).not.toHaveBeenCalled()
    expect(container.textContent).toBe('')
  })

  it('ignores the in-flight window before the first read resolves', () => {
    render({ data: null, isPending: true })

    expect(mockRecoverFromStaleSession).not.toHaveBeenCalled()
  })

  it('names impersonation when that is what expired', () => {
    render(IMPERSONATED)
    render(GONE)

    expect(container.textContent).toContain('The impersonation session expired')
  })

  it('recovers once, not on every subsequent render', () => {
    render(LIVE)
    render(GONE)
    render(GONE)

    expect(mockRecoverFromStaleSession).toHaveBeenCalledOnce()
  })

  it('offers a retry when signing out fails', async () => {
    mockRecoverFromStaleSession.mockResolvedValue(false)
    render(LIVE)

    await act(async () => {
      render(GONE)
    })

    expect(container.textContent).toContain('but signing out failed')
    const retry = container.querySelector('button')
    expect(retry).not.toBeNull()

    await act(async () => {
      retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(mockRecoverFromStaleSession).toHaveBeenCalledTimes(2)
  })
})
