import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ clearUserData: vi.fn() }))
vi.mock('@/lib/auth/auth-client', () => authClientMock)
vi.mock('@/stores', () => ({ clearUserData: mocks.clearUserData }))

import { signOutAndRedirect } from '@/lib/auth/sign-out'

const { mockSignOut } = authClientMockFns

const navigate = vi.fn()
const assign = vi.fn()

beforeEach(() => {
  mockSignOut.mockResolvedValue(undefined)
  mocks.clearUserData.mockResolvedValue(true)
  vi.stubGlobal('window', { location: { assign } })
})

describe('signOutAndRedirect', () => {
  it('reloads when in-memory state could not be cleared', async () => {
    mocks.clearUserData.mockResolvedValue(false)
    await signOutAndRedirect(navigate)
    expect(navigate).not.toHaveBeenCalled()
    expect(assign).toHaveBeenCalledWith('/login?fromLogout=true')
  })

  it('reloads on sign-out failure and still attempts to clear user state', async () => {
    mockSignOut.mockRejectedValue(new Error('offline'))
    await signOutAndRedirect(navigate)
    expect(mocks.clearUserData).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()
    expect(assign).toHaveBeenCalledWith('/login?fromLogout=true')
  })
})
