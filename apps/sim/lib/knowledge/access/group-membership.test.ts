import { describe, expect, it } from 'vitest'
import {
  assertExternalGroupTokenCapacity,
  MAX_EXTERNAL_GROUP_TOKENS,
} from '@/lib/knowledge/access/group-membership'

describe('external group token capacity', () => {
  it('rejects the overflow sentinel instead of returning a truncated access set', () => {
    const tokens = Array.from({ length: MAX_EXTERNAL_GROUP_TOKENS }, () => 'g:confluence:cloud:g')
    expect(() => assertExternalGroupTokenCapacity(tokens)).not.toThrow()
    expect(() => assertExternalGroupTokenCapacity([...tokens, 'g:confluence:cloud:last'])).toThrow(
      'token capacity'
    )
  })

  it('bounds retained token bytes independently of the number of groups', () => {
    const token = `g:confluence:cloud:${'x'.repeat(1024)}`
    expect(() =>
      assertExternalGroupTokenCapacity(Array.from({ length: 16_384 }, () => token))
    ).toThrow('token byte capacity')
  })
})
