/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { readBoundMemorySecretProvenance } from '@/lib/memory/secret-provenance'

describe('memory secret provenance', () => {
  it('treats a marker-null row as legacy even when an old sidecar remains', () => {
    expect(
      readBoundMemorySecretProvenance({
        secretProvenanceVersion: null,
        data: { value: 'changed-by-old-app' },
        provenanceContentHash: 'stale',
        status: 'exact',
        entries: [{ name: 'SECRET', encryptedValue: 'encrypted' }],
      })
    ).toEqual({ status: 'exact', entries: [] })
  })
})
