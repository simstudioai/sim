/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { mountedSecretNamesSchema } from '@/lib/api/contracts/secret-mount-policy'
import {
  MAX_SECRET_MOUNT_NAME_LENGTH,
  MAX_SECRET_MOUNT_NAMES,
} from '@/lib/copilot/secret-mount-policy'

describe('mountedSecretNamesSchema', () => {
  it('accepts the bounded names-only policy shape', () => {
    expect(mountedSecretNamesSchema.parse([' API_KEY ', 'name-with-dashes'])).toEqual([
      'API_KEY',
      'name-with-dashes',
    ])
  })

  it('rejects too many names', () => {
    expect(() =>
      mountedSecretNamesSchema.parse(
        Array.from({ length: MAX_SECRET_MOUNT_NAMES + 1 }, (_, index) => `SECRET_${index}`)
      )
    ).toThrow()
  })

  it('rejects an overlong name without narrowing the runtime name grammar', () => {
    expect(() =>
      mountedSecretNamesSchema.parse(['S'.repeat(MAX_SECRET_MOUNT_NAME_LENGTH + 1)])
    ).toThrow()
  })
})
