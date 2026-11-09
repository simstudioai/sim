/**
 * @vitest-environment jsdom
 *
 * Failure modes: a desktop tool outliving a sign-out whose request hangs, and a failed sign-out
 * leaving tools running or navigating anyway.
 */
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/client', () => authClientMock)

import { desktopToolSession } from '@/hooks/mothership-chat/desktop-tool-lifetimes'
import { signOutAndLeave } from '@/platform/lib/data/session'

const { mockSignOut } = authClientMockFns
const assign = vi.fn()

beforeEach(() => {
  assign.mockReset()
  mockSignOut.mockReset()
  vi.stubGlobal('location', { ...window.location, assign })
})

describe('signOutAndLeave', () => {
  it('stops running desktop tools while the sign-out request is still pending', async () => {
    let finishSignOut!: () => void
    mockSignOut.mockReturnValue(
      new Promise<void>((resolve) => {
        finishSignOut = resolve
      })
    )
    const tool = desktopToolSession().turn('turn-sign-out').lease()

    const leaving = signOutAndLeave('/login?fromLogout=true')

    await vi.waitFor(() => expect(tool.signal.aborted).toBe(true))
    expect(assign).not.toHaveBeenCalled()
    finishSignOut()
    await expect(leaving).resolves.toBe(true)
    expect(assign).toHaveBeenCalledExactlyOnceWith('/login?fromLogout=true')
  })

  it('still stops desktop tools but stays put when sign-out fails', async () => {
    mockSignOut.mockRejectedValue(new Error('offline'))
    const tool = desktopToolSession().turn('turn-failed').lease()

    await expect(signOutAndLeave('/login')).resolves.toBe(false)

    expect(tool.signal.aborted).toBe(true)
    expect(assign).not.toHaveBeenCalled()
  })
})
