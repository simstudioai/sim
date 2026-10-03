import { describe, expect, it, vi } from 'vitest'
import { registerUserDataReset, resetRegisteredUserData } from '@/stores/user-data-reset-registry'

describe('user data reset registry', () => {
  it('continues resetting loaded stores before reporting a failure', () => {
    const resetError = new Error('reset failed')
    const successfulReset = vi.fn()
    const failingReset = vi.fn().mockImplementationOnce(() => {
      throw resetError
    })
    registerUserDataReset('test-failing', failingReset)
    registerUserDataReset('test-successful', successfulReset)

    expect(() => resetRegisteredUserData()).toThrow(resetError)
    expect(successfulReset).toHaveBeenCalledOnce()
  })
})
