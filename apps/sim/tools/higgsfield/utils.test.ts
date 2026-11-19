import { describe, expect, it } from 'vitest'
import { UserFailure } from '@/lib/core/errors/user-failure'
import { higgsfieldHeaders } from '@/tools/higgsfield/utils'

describe('higgsfieldHeaders', () => {
  it('asks for a credential instead of crashing when none was resolved', () => {
    expect(() => higgsfieldHeaders(undefined, true)).toThrow(UserFailure)
    expect(() => higgsfieldHeaders(undefined, true)).toThrow(/Higgsfield credential/)
  })
})
