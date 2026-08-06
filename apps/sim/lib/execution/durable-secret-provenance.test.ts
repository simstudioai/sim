/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  filterDurableSecretProvenanceBySourceValues,
  hashDurableSecretProvenanceValue,
} from '@/lib/execution/durable-secret-provenance'

describe('durable secret provenance hashing', () => {
  it('hashes equivalent plain JSON deterministically without key-order sensitivity', () => {
    expect(hashDurableSecretProvenanceValue({ b: [true, null], a: 'value' })).toBe(
      hashDurableSecretProvenanceValue({ a: 'value', b: [true, null] })
    )
  })

  it('rejects values that cannot be safely and unambiguously canonicalized', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const accessor = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => 'secret',
    })
    let deep: unknown = null
    for (let index = 0; index < 101; index++) deep = [deep]

    expect(hashDurableSecretProvenanceValue(undefined)).toBeUndefined()
    expect(hashDurableSecretProvenanceValue(Number.NaN)).toBeUndefined()
    expect(hashDurableSecretProvenanceValue(cyclic)).toBeUndefined()
    expect(hashDurableSecretProvenanceValue(accessor)).toBeUndefined()
    expect(hashDurableSecretProvenanceValue(deep)).toBeUndefined()
  })

  it('does not broaden an unbound entry into a field-level selection', () => {
    expect(
      filterDurableSecretProvenanceBySourceValues(
        {
          status: 'exact',
          entries: [
            {
              name: 'SECRET',
              encryptedValue: 'encrypted',
              sourceUserId: 'user-1',
            },
          ],
        },
        ['same-low-entropy-value']
      )
    ).toEqual({ status: 'exact', entries: [] })
  })
})
