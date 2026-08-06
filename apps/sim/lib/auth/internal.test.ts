/**
 * @vitest-environment node
 */

import { resetEnvMock } from '@sim/testing'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.unmock('@/lib/auth/internal')

import { generateInternalToken, verifyInternalToken } from '@/lib/auth/internal'

afterAll(resetEnvMock)

describe('internal JWT claims', () => {
  it('round-trips the trusted Mothership sandbox profile', async () => {
    const token = await generateInternalToken('user-1', { sandboxProfile: 'mothership' })

    await expect(verifyInternalToken(token)).resolves.toMatchObject({
      valid: true,
      userId: 'user-1',
      sandboxProfile: 'mothership',
    })
  })

  it('keeps ordinary internal tokens profile-free', async () => {
    const token = await generateInternalToken('user-1')

    await expect(verifyInternalToken(token)).resolves.toEqual({
      valid: true,
      userId: 'user-1',
    })
  })

  it('rejects unknown sandbox profiles instead of falling back to another image', async () => {
    const token = await generateInternalToken('user-1', {
      sandboxProfile: 'unknown-profile' as never,
    })

    await expect(verifyInternalToken(token)).resolves.toEqual({ valid: false })
  })
})
