import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDecryptSecret } = vi.hoisted(() => ({
  mockDecryptSecret: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
}))

import {
  ANONYMOUS_SECRET_TRACE_REPLACEMENT,
  createResolvedSecretTraceRegistry,
  isResolvedSecretTraceProvenanceV1,
  ResolvedSecretTraceProvenanceAccumulator,
  type ResolvedSecretTraceProvenanceV1,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

describe('ResolvedSecretTraceProvenanceAccumulator', () => {
  const scope = { userId: 'user-1', workspaceId: 'workspace-1' }

  it('unions cold, warm, and retry reports while complete', () => {
    const accumulator = new ResolvedSecretTraceProvenanceAccumulator(scope)

    expect(
      accumulator.record({
        version: 1,
        complete: true,
        entries: [{ name: 'OLD_TOKEN', encryptedValue: 'encrypted-v1' }],
        scope,
      })
    ).toBe(true)
    expect(
      accumulator.record({
        version: 1,
        complete: true,
        entries: [{ name: 'NEW_TOKEN', encryptedValue: 'encrypted-v2' }],
        scope,
      })
    ).toBe(true)
    accumulator.record({
      version: 1,
      complete: true,
      entries: [{ name: 'OLD_TOKEN', encryptedValue: 'encrypted-v1' }],
      scope,
    })

    expect(accumulator.exportProvenance()).toEqual({
      version: 1,
      complete: true,
      entries: [
        { name: 'OLD_TOKEN', encryptedValue: 'encrypted-v1' },
        { name: 'NEW_TOKEN', encryptedValue: 'encrypted-v2' },
      ],
      scope,
    })
  })

  it('discards accumulated and future entries once completeness is lost', () => {
    const accumulator = new ResolvedSecretTraceProvenanceAccumulator(scope)

    accumulator.record({
      version: 1,
      complete: true,
      entries: [{ name: 'OLD_TOKEN', encryptedValue: 'encrypted-v1' }],
      scope,
    })
    expect(
      accumulator.record({
        version: 1,
        complete: false,
        entries: [],
        scope,
      })
    ).toBe(true)
    expect(
      accumulator.record({
        version: 1,
        complete: true,
        entries: [{ name: 'NEW_TOKEN', encryptedValue: 'encrypted-v2' }],
        scope,
      })
    ).toBe(true)

    expect(accumulator.exportProvenance()).toEqual({
      version: 1,
      complete: false,
      entries: [],
      scope,
    })
  })

  it('discards mismatched-scope reports and marks them incomplete', () => {
    const accumulator = new ResolvedSecretTraceProvenanceAccumulator(scope)

    expect(
      accumulator.record({
        version: 1,
        complete: true,
        entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-value' }],
        scope: { userId: 'user-1', workspaceId: 'workspace-2' },
      })
    ).toBe(true)

    expect(accumulator.exportProvenance()).toEqual({
      version: 1,
      complete: false,
      entries: [],
      scope,
    })
  })

  it('fails closed for malformed reports and terminal incompleteness', () => {
    const accumulator = new ResolvedSecretTraceProvenanceAccumulator(scope)
    accumulator.record({
      version: 1,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-value' }],
      scope,
    })

    expect(accumulator.record({ version: 1 })).toBe(false)
    expect(accumulator.exportProvenance()).toEqual({
      version: 1,
      complete: false,
      entries: [],
      scope,
    })

    accumulator.record({
      version: 1,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-value' }],
      scope,
    })
    accumulator.markIncomplete()
    expect(accumulator.exportProvenance().entries).toEqual([])
  })
})

describe('ResolvedSecretTraceRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted: `decrypted:${encryptedValue}`,
    }))
  })

  it('starts with an inert catalog and activates only an exact successful resolution', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: 'secret-value', encryptedValue: 'encrypted-value' },
    ])

    expect(registry.getActiveMatches()).toEqual([])
    expect(registry.recordResolved('API_KEY', 'wrong-value')).toBe(false)
    expect(registry.recordResolved('MISSING', 'secret-value')).toBe(false)
    expect(registry.getActiveMatches()).toEqual([])
    expect(registry.isComplete()).toBe(false)

    expect(registry.recordResolved('API_KEY', 'secret-value')).toBe(true)
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'secret-value', replacement: '{{API_KEY}}' },
    ])
  })

  it('fails closed while one or more secret activations are pending', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: 'secret-value', encryptedValue: 'encrypted-value' },
    ])
    const completeFirst = registry.beginPendingActivation()
    const completeSecond = registry.beginPendingActivation()

    expect(registry.isComplete()).toBe(false)
    expect(registry.exportProvenance()).toEqual({
      version: 1,
      complete: false,
      entries: [],
    })

    registry.recordResolved('API_KEY', 'secret-value')
    completeFirst()
    expect(registry.isComplete()).toBe(false)

    completeSecond()
    completeSecond()
    expect(registry.isComplete()).toBe(true)
    expect(registry.exportProvenance()).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-value' }],
    })
  })

  it('uses the workspace catalog entry when personal and workspace names conflict', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: { SHARED: 'personal-encrypted' },
      workspaceEncrypted: { SHARED: 'workspace-encrypted' },
      personalDecrypted: { SHARED: 'personal-secret' },
      workspaceDecrypted: { SHARED: 'workspace-secret' },
    })

    expect(registry.recordResolved('SHARED', 'workspace-secret')).toBe(true)
    expect(registry.exportProvenance()).toEqual({
      version: 1,
      complete: true,
      entries: [{ name: 'SHARED', encryptedValue: 'workspace-encrypted' }],
    })
  })

  it('ignores empty decryption failures but fails closed for a resolved value outside the catalog', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: { FAILED: 'failed-ciphertext' },
      workspaceEncrypted: {},
      personalDecrypted: { FAILED: '', DECRYPTED_ONLY: 'not-catalogued' },
      workspaceDecrypted: {},
      decryptionFailures: ['FAILED'],
    })

    expect(registry.isComplete()).toBe(true)
    expect(registry.recordResolved('FAILED', '')).toBe(false)
    expect(registry.isComplete()).toBe(true)
    expect(registry.recordResolved('DECRYPTED_ONLY', 'not-catalogued')).toBe(false)
    expect(registry.isComplete()).toBe(false)
  })

  it('keeps a successful workspace override when the shadowed personal value failed', async () => {
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: { SHARED: 'broken-personal-ciphertext' },
      workspaceEncrypted: { SHARED: 'workspace-ciphertext' },
      personalDecrypted: { SHARED: '' },
      workspaceDecrypted: { SHARED: 'workspace-secret' },
      decryptionFailures: ['SHARED'],
    })

    expect(registry.recordResolved('SHARED', 'workspace-secret')).toBe(true)
    expect(registry.exportProvenance().entries).toEqual([
      { name: 'SHARED', encryptedValue: 'workspace-ciphertext' },
    ])
  })

  it('exports encrypted active provenance without plaintext', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'raw-secret', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'raw-secret')

    const serialized = JSON.stringify(registry.exportProvenance())
    expect(serialized).toContain('ciphertext')
    expect(serialized).not.toContain('raw-secret')
  })

  it('restores old encrypted values alongside the current catalog after rotation', async () => {
    mockDecryptSecret.mockResolvedValueOnce({ decrypted: 'old-secret' })
    const oldProvenance: ResolvedSecretTraceProvenanceV1 = {
      version: 1,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'old-ciphertext' }],
    }
    const registry = await createResolvedSecretTraceRegistry({
      personalEncrypted: { TOKEN: 'new-ciphertext' },
      workspaceEncrypted: {},
      personalDecrypted: { TOKEN: 'new-secret' },
      workspaceDecrypted: {},
      restoredProvenance: oldProvenance,
      restoreTrusted: true,
      requireRestoredProvenance: true,
    })

    registry.recordResolved('TOKEN', 'new-secret')

    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'new-secret', replacement: '{{TOKEN}}' },
      { plaintext: 'old-secret', replacement: '{{TOKEN}}' },
    ])
    expect(registry.exportProvenance().entries).toEqual([
      { name: 'TOKEN', encryptedValue: 'new-ciphertext' },
      { name: 'TOKEN', encryptedValue: 'old-ciphertext' },
    ])
  })

  it('marks untrusted, missing, malformed, and undecryptable restoration incomplete', async () => {
    const provenance: ResolvedSecretTraceProvenanceV1 = {
      version: 1,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'ciphertext' }],
    }
    const untrusted = new ResolvedSecretTraceRegistry()
    expect(await untrusted.importProvenance(provenance, { trusted: false })).toBe(false)
    expect(untrusted.isComplete()).toBe(false)
    expect(mockDecryptSecret).not.toHaveBeenCalled()

    const missing = await createResolvedSecretTraceRegistry({
      personalEncrypted: {},
      workspaceEncrypted: {},
      personalDecrypted: {},
      workspaceDecrypted: {},
      requireRestoredProvenance: true,
      restoreTrusted: true,
    })
    expect(missing.isComplete()).toBe(false)

    const malformed = new ResolvedSecretTraceRegistry()
    expect(await malformed.importProvenance({ version: 1 }, { trusted: true })).toBe(false)
    expect(malformed.isComplete()).toBe(false)

    mockDecryptSecret.mockRejectedValueOnce(new Error('cannot decrypt'))
    const undecryptable = new ResolvedSecretTraceRegistry()
    expect(await undecryptable.importProvenance(provenance, { trusted: true })).toBe(false)
    expect(undecryptable.isComplete()).toBe(false)
  })

  it('uses anonymous replacements for cross-scope provenance', async () => {
    mockDecryptSecret.mockResolvedValueOnce({ decrypted: 'publisher-secret' })
    const registry = new ResolvedSecretTraceRegistry()
    await registry.importProvenance(
      {
        version: 1,
        complete: true,
        entries: [{ name: 'PUBLISHER_TOKEN', encryptedValue: 'publisher-ciphertext' }],
      },
      { trusted: true, anonymous: true }
    )

    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'publisher-secret', replacement: ANONYMOUS_SECRET_TRACE_REPLACEMENT },
    ])
    expect(registry.exportProvenance().entries).toEqual([
      { encryptedValue: 'publisher-ciphertext' },
    ])
  })

  it('preserves labels only when imported provenance has the same complete scope', async () => {
    const provenance: ResolvedSecretTraceProvenanceV1 = {
      version: 1,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'ciphertext' }],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    }
    const sameScope = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    const mismatchedScope = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-2',
    })
    const missingReceiverScope = new ResolvedSecretTraceRegistry()
    const missingSourceScope = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    expect(await sameScope.importProvenance(provenance, { trusted: true })).toBe(true)
    expect(await mismatchedScope.importProvenance(provenance, { trusted: true })).toBe(true)
    expect(await missingReceiverScope.importProvenance(provenance, { trusted: true })).toBe(true)
    expect(
      await missingSourceScope.importProvenance(
        { version: 1, complete: true, entries: provenance.entries },
        { trusted: true }
      )
    ).toBe(true)

    expect(sameScope.getActiveMatches()).toEqual([
      { plaintext: 'decrypted:ciphertext', replacement: '{{TOKEN}}' },
    ])
    for (const registry of [mismatchedScope, missingReceiverScope, missingSourceScope]) {
      expect(registry.getActiveMatches()).toEqual([
        {
          plaintext: 'decrypted:ciphertext',
          replacement: ANONYMOUS_SECRET_TRACE_REPLACEMENT,
        },
      ])
    }
  })

  it('imports all same-scope provenance across an in-process boundary', async () => {
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    const provenance: ResolvedSecretTraceProvenanceV1 = {
      version: 1,
      complete: true,
      entries: [
        { name: 'PRESENT', encryptedValue: 'present-ciphertext' },
        { name: 'DORMANT_IN_OUTPUT', encryptedValue: 'other-ciphertext' },
      ],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    }

    expect(
      await registry.importCrossingProvenance(
        provenance,
        { output: 'decrypted:present-ciphertext' },
        { trusted: true }
      )
    ).toBe(true)

    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'decrypted:present-ciphertext', replacement: '{{PRESENT}}' },
      { plaintext: 'decrypted:other-ciphertext', replacement: '{{DORMANT_IN_OUTPUT}}' },
    ])
  })

  it('filters and anonymizes provenance crossing from another scope', async () => {
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    const provenance: ResolvedSecretTraceProvenanceV1 = {
      version: 1,
      complete: true,
      entries: [
        { name: 'PRESENT', encryptedValue: 'present-ciphertext' },
        { name: 'ABSENT', encryptedValue: 'absent-ciphertext' },
      ],
      scope: { userId: 'user-1', workspaceId: 'workspace-2' },
    }

    expect(
      await registry.importCrossingProvenance(
        provenance,
        { output: 'decrypted:present-ciphertext' },
        { trusted: true }
      )
    ).toBe(true)

    expect(registry.getActiveMatches()).toEqual([
      {
        plaintext: 'decrypted:present-ciphertext',
        replacement: ANONYMOUS_SECRET_TRACE_REPLACEMENT,
      },
    ])
  })

  it('exports only active secrets whose exact literals cross a value boundary', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'PRESENT', plaintext: 'present-secret', encryptedValue: 'present-ciphertext' },
      { name: 'ABSENT', plaintext: 'absent-secret', encryptedValue: 'absent-ciphertext' },
      { name: 'UNUSED', plaintext: 'unused-secret', encryptedValue: 'unused-ciphertext' },
    ])
    registry.recordResolved('PRESENT', 'present-secret')
    registry.recordResolved('ABSENT', 'absent-secret')

    const provenance = registry.exportProvenanceForValue(
      { nested: [{ 'key-present-secret': new Error('failed with present-secret') }] },
      { anonymous: true }
    )

    expect(provenance).toEqual({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'present-ciphertext' }],
    })
  })

  it('exports active numeric, boolean, and null literals crossing a value boundary', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'NUMBER', plaintext: '1234', encryptedValue: 'number-ciphertext' },
      { name: 'BOOLEAN', plaintext: 'false', encryptedValue: 'boolean-ciphertext' },
      { name: 'NULL', plaintext: 'null', encryptedValue: 'null-ciphertext' },
      { name: 'ABSENT', plaintext: '5678', encryptedValue: 'absent-ciphertext' },
    ])
    registry.recordResolved('NUMBER', '1234')
    registry.recordResolved('BOOLEAN', 'false')
    registry.recordResolved('NULL', 'null')
    registry.recordResolved('ABSENT', '5678')

    expect(
      registry.exportProvenanceForValue(
        { number: 1234, boolean: false, nullable: null },
        { anonymous: true }
      )
    ).toEqual({
      version: 1,
      complete: true,
      entries: [
        { encryptedValue: 'boolean-ciphertext' },
        { encryptedValue: 'null-ciphertext' },
        { encryptedValue: 'number-ciphertext' },
      ],
    })
  })

  it('marks a bounded cross-boundary scan incomplete when an enumerable accessor is opaque', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'secret')
    const value = {}
    Object.defineProperty(value, 'opaque', {
      enumerable: true,
      get: () => 'secret',
    })

    expect(registry.exportProvenanceForValue(value, { anonymous: true })).toEqual({
      version: 1,
      complete: false,
      entries: [],
    })
  })

  it('does not claim a complete cross-boundary scan for opaque large-value refs', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'secret')

    expect(
      registry.exportProvenanceForValue(
        {
          __simLargeValueRef: true,
          version: 1,
          id: 'lv_ABCDEFGHIJKL',
          kind: 'object',
          size: 1024,
        },
        { anonymous: true }
      )
    ).toEqual({ version: 1, complete: false, entries: [] })
  })

  it('does not snapshot or enqueue an entire wide crossing object', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'needle-value', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'needle-value')
    const wideValue: Record<string, string> = {}
    for (let index = 0; index < 30_000; index++) {
      wideValue[`field_${index}`] = 'safe-value'
    }
    const descriptorSnapshotSpy = vi.spyOn(Object, 'getOwnPropertyDescriptors')
    const provenance = registry.exportProvenanceForValue(wideValue, { anonymous: true })
    const descriptorSnapshotCalls = descriptorSnapshotSpy.mock.calls.length
    descriptorSnapshotSpy.mockRestore()

    expect(provenance).toEqual({
      version: 1,
      complete: false,
      entries: [],
    })
    expect(descriptorSnapshotCalls).toBe(0)
  })

  it('handles duplicate and empty values deterministically', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'Z_TOKEN', plaintext: 'same', encryptedValue: 'z-ciphertext' },
      { name: 'A_TOKEN', plaintext: 'same', encryptedValue: 'a-ciphertext' },
      { name: 'EMPTY', plaintext: '', encryptedValue: 'empty-ciphertext' },
      { name: 'A', plaintext: 'A', encryptedValue: 'short-ciphertext' },
    ])
    registry.recordResolved('Z_TOKEN', 'same')
    registry.recordResolved('A_TOKEN', 'same')
    registry.recordResolved('EMPTY', '')

    expect(registry.getActiveMatches()).toEqual([{ plaintext: 'same', replacement: '{{A_TOKEN}}' }])

    registry.recordResolved('A', 'A')
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'same', replacement: '{{A_TOKEN}}' },
      { plaintext: 'A', replacement: '{{A}}' },
    ])
  })

  it('marks the registry incomplete when active provenance exceeds its hard cap', () => {
    const entries = Array.from({ length: 10_001 }, (_, index) => ({
      name: `SECRET_${index}`,
      plaintext: `value-${index}`,
      encryptedValue: `ciphertext-${index}`,
    }))
    const registry = new ResolvedSecretTraceRegistry(entries)

    for (const entry of entries) {
      registry.recordResolved(entry.name, entry.plaintext)
    }

    expect(registry.isComplete()).toBe(false)
    expect(registry.exportProvenance().entries).toEqual([])
  })

  it('bounds provenance by serialized JSON bytes including control-character escapes', () => {
    const encryptedValue = '\u0000'.repeat(1_400_000)
    const provenance: ResolvedSecretTraceProvenanceV1 = {
      version: 1,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue }],
    }

    expect(Buffer.byteLength(encryptedValue, 'utf8')).toBeLessThan(8 * 1024 * 1024)
    expect(Buffer.byteLength(JSON.stringify(provenance), 'utf8')).toBeGreaterThan(8 * 1024 * 1024)
    expect(isResolvedSecretTraceProvenanceV1(provenance)).toBe(false)

    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret', encryptedValue },
    ])
    expect(registry.recordResolved('TOKEN', 'secret')).toBe(true)
    expect(registry.isComplete()).toBe(false)
    expect(registry.exportProvenance().entries).toEqual([])
  })

  it('rejects incomplete provenance that still carries entries', () => {
    expect(
      isResolvedSecretTraceProvenanceV1({
        version: 1,
        complete: false,
        entries: [{ name: 'TOKEN', encryptedValue: 'ciphertext' }],
      })
    ).toBe(false)
  })

  it('rejects non-canonical provenance fields before applying the serialized-size bound', () => {
    const entry = { name: 'TOKEN', encryptedValue: 'ciphertext' }
    const scope = { userId: 'user-1', workspaceId: 'workspace-1' }

    expect(
      isResolvedSecretTraceProvenanceV1({
        version: 1,
        complete: true,
        entries: [entry],
        scope,
        extra: 'not-transported',
      })
    ).toBe(false)
    expect(
      isResolvedSecretTraceProvenanceV1({
        version: 1,
        complete: true,
        entries: [{ ...entry, extra: 'not-transported' }],
        scope,
      })
    ).toBe(false)
    expect(
      isResolvedSecretTraceProvenanceV1({
        version: 1,
        complete: true,
        entries: [entry],
        scope: { ...scope, extra: 'not-transported' },
      })
    ).toBe(false)

    const entries = [entry]
    Object.assign(entries, { extra: 'not-transported' })
    expect(isResolvedSecretTraceProvenanceV1({ version: 1, complete: true, entries, scope })).toBe(
      false
    )
  })

  it('stops consuming a dormant catalog when its entry cap is exceeded', () => {
    let yieldedEntries = 0
    function* catalogEntries() {
      for (let index = 0; index < 20_000; index++) {
        yieldedEntries++
        yield {
          name: `SECRET_${index}`,
          plaintext: `value-${index}`,
          encryptedValue: `ciphertext-${index}`,
        }
      }
    }

    const registry = new ResolvedSecretTraceRegistry(catalogEntries())

    expect(yieldedEntries).toBe(10_001)
    expect(registry.isComplete()).toBe(false)
    expect(registry.exportProvenance().entries).toEqual([])
  })

  it('marks an oversized dormant catalog value incomplete without retaining it', () => {
    const oversizedPlaintext = 'x'.repeat(8 * 1024 * 1024)
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'OVERSIZED',
        plaintext: oversizedPlaintext,
        encryptedValue: 'ciphertext',
      },
    ])

    expect(registry.isComplete()).toBe(false)
    expect(registry.recordResolved('OVERSIZED', oversizedPlaintext)).toBe(false)
    expect(registry.getActiveMatches()).toEqual([])
  })
})
