/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { SecretProvenanceBudget } from '@/lib/execution/provenance-budget'
import {
  PROVENANCE_MAX_ENTRIES,
  PROVENANCE_MAX_SERIALIZED_BYTES,
} from '@/lib/execution/provenance-limits'

describe('incremental provenance budget', () => {
  it('charges repeated bindings against bytes but only distinct ciphertexts against secrets', () => {
    const budget = new SecretProvenanceBudget()
    for (let index = 0; index < PROVENANCE_MAX_ENTRIES + 1; index++) {
      expect(budget.add('same-ciphertext', 100)).toBe(true)
    }
  })

  it('refuses an additional distinct secret without refusing another binding of a known secret', () => {
    const budget = new SecretProvenanceBudget()
    for (let index = 0; index < PROVENANCE_MAX_ENTRIES; index++) {
      expect(budget.add(`ciphertext-${index}`, 100)).toBe(true)
    }
    expect(budget.add('additional-secret', 100)).toBe(false)
    expect(budget.add('ciphertext-0', 100)).toBe(true)
  })

  it('includes brackets and commas and does not consume capacity on a rejected binding', () => {
    const budget = new SecretProvenanceBudget()
    expect(budget.add('first', PROVENANCE_MAX_SERIALIZED_BYTES - 5)).toBe(true)
    expect(budget.add('too-large', 3)).toBe(false)
    expect(budget.add('fits', 2)).toBe(true)
    expect(budget.add('fits', 2)).toBe(false)
  })
})
