/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ signOut: vi.fn(), clearUserData: vi.fn() }))
vi.mock('@/lib/auth/auth-client', () => ({ signOut: mocks.signOut }))
vi.mock('@/stores', () => ({ clearUserData: mocks.clearUserData }))

import { signOutAndRedirect } from '@/lib/auth/sign-out'

const navigate = vi.fn()
const assign = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mocks.signOut.mockResolvedValue(undefined)
  mocks.clearUserData.mockResolvedValue(true)
  vi.stubGlobal('window', { location: { assign } })
})
afterEach(() => vi.unstubAllGlobals())

describe('signOutAndRedirect', () => {
  it('ends the session and clears user state before navigating in-app', async () => {
    await signOutAndRedirect(navigate)
    expect(mocks.signOut).toHaveBeenCalledOnce()
    expect(mocks.clearUserData).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith('/login?fromLogout=true')
    expect(assign).not.toHaveBeenCalled()
  })

  it('reloads when in-memory state could not be cleared', async () => {
    mocks.clearUserData.mockResolvedValue(false)
    await signOutAndRedirect(navigate)
    expect(navigate).not.toHaveBeenCalled()
    expect(assign).toHaveBeenCalledWith('/login?fromLogout=true')
  })

  it('reloads on sign-out failure and still attempts to clear user state', async () => {
    mocks.signOut.mockRejectedValue(new Error('offline'))
    await signOutAndRedirect(navigate)
    expect(mocks.clearUserData).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()
    expect(assign).toHaveBeenCalledWith('/login?fromLogout=true')
  })
})
