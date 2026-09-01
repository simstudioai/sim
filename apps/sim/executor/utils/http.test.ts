/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateInternalToken: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: mocks.generateInternalToken,
}))

import { buildAuthHeaders } from '@/executor/utils/http'

describe('executor HTTP authentication headers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.generateInternalToken.mockResolvedValue('legacy-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mints an internal token for server-side calls', async () => {
    await expect(buildAuthHeaders('user-1')).resolves.toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer legacy-token',
    })
    expect(mocks.generateInternalToken).toHaveBeenCalledWith('user-1')
  })
})
