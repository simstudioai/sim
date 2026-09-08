/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEnforced, mockReport } = vi.hoisted(() => ({
  mockIsEnforced: vi.fn(() => false),
  mockReport: vi.fn(),
}))

vi.mock('@/lib/execution/durable-secret-provenance-enforcement', () => ({
  DURABLE_SECRET_PROVENANCE_SURFACES: ['memory', 'table-row', 'knowledge'],
  isDurableSecretProvenanceEnforced: mockIsEnforced,
  reportUnrecordedDurableProvenance: mockReport,
}))

import {
  durableSecretProvenanceFromPrivateBundle,
  filterDurableSecretProvenanceBySourceValues,
  hashDurableSecretProvenanceValue,
  importDurableSecretProvenance,
  mergeDurableSecretProvenance,
  normalizeDurableSecretProvenanceEntries,
} from '@/lib/execution/durable-secret-provenance'
import {
  PROVENANCE_MAX_ENTRIES,
  PROVENANCE_MAX_SERIALIZED_BYTES,
} from '@/lib/execution/provenance-limits'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

function privateBundle(scope?: { userId: string; workspaceId?: string }) {
  return {
    version: 1 as const,
    complete: true,
    selections: [
      {
        key: 'value',
        provenance: {
          version: 1 as const,
          complete: true,
          entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
          ...(scope ? { scope } : {}),
        },
      },
    ],
  }
}

describe('durable secret provenance hashing', () => {
  it('hashes many small values within the byte budget without a separate node cutoff', () => {
    const messages = Array.from({ length: 17_000 }, (_, index) => ({
      role: 'user',
      content: `message ${index}`,
    }))
    const hash = hashDurableSecretProvenanceValue(messages)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hashDurableSecretProvenanceValue(structuredClone(messages))).toBe(hash)
    expect(hashDurableSecretProvenanceValue('x'.repeat(16 * 1024 * 1024))).toBeUndefined()
  })

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

describe('durable provenance binding capacity', () => {
  it('folds duplicates while preserving more than 10,000 bindings of one secret', () => {
    const entries = Array.from({ length: PROVENANCE_MAX_ENTRIES + 1 }, (_, index) => ({
      encryptedValue: 'ciphertext',
      sourceValueHash: `hash-${index}`,
    }))
    const normalized = normalizeDurableSecretProvenanceEntries(entries)
    expect(normalized).toHaveLength(entries.length)
    expect(
      mergeDurableSecretProvenance({ status: 'exact', entries }, { status: 'exact', entries })
    ).toEqual({ status: 'exact', entries: normalized })
    expect(normalizeDurableSecretProvenanceEntries(Array(entries.length).fill(entries[0]))).toEqual(
      [entries[0]]
    )
  })

  it('still refuses more than 10,000 distinct secrets', () => {
    const entries = Array.from({ length: PROVENANCE_MAX_ENTRIES + 1 }, (_, index) => ({
      encryptedValue: `ciphertext-${index}`,
    }))
    expect(normalizeDurableSecretProvenanceEntries(entries.slice(0, -1))).toHaveLength(
      PROVENANCE_MAX_ENTRIES
    )
    expect(normalizeDurableSecretProvenanceEntries(entries)).toBeUndefined()
  })

  it('measures escaped UTF-8 JSON bytes including array separators', () => {
    const entry = { encryptedValue: 'ciphertext', name: 'é\n' }
    const overhead = Buffer.byteLength(JSON.stringify([entry]), 'utf8')
    const exact = {
      ...entry,
      encryptedValue: entry.encryptedValue + 'x'.repeat(PROVENANCE_MAX_SERIALIZED_BYTES - overhead),
    }
    expect(normalizeDurableSecretProvenanceEntries([exact])).toEqual([exact])
    expect(
      normalizeDurableSecretProvenanceEntries([
        { ...exact, encryptedValue: `${exact.encryptedValue}x` },
      ])
    ).toBeUndefined()
    expect(normalizeDurableSecretProvenanceEntries([exact, entry])).toBeUndefined()
  })

  it('preserves distinct bindings whose fields contain delimiter characters', () => {
    const entries = [
      { encryptedValue: 'ciphertext', name: 'name', sourceValueHash: 'hash\u0000part' },
      { encryptedValue: 'ciphertext', name: 'part\u0000name', sourceValueHash: 'hash' },
    ]
    expect(normalizeDurableSecretProvenanceEntries(entries)).toHaveLength(2)
  })

  it('folds message hashes only after selection while retaining source scope and names on import', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    const imported = vi.spyOn(registry, 'importProvenance').mockResolvedValue(true)
    const entries = Array.from({ length: PROVENANCE_MAX_ENTRIES + 1 }, (_, index) => ({
      encryptedValue: 'ciphertext',
      name: 'TOKEN',
      sourceUserId: 'source-user',
      sourceWorkspaceId: 'source-workspace',
      sourceValueHash: `hash-${index}`,
    }))
    await expect(
      importDurableSecretProvenance(registry, {
        status: 'exact',
        entries: [
          ...entries,
          { ...entries[0], name: 'ALIAS' },
          { ...entries[0], sourceUserId: 'other-user' },
        ],
      })
    ).resolves.toBe(true)
    expect(imported).toHaveBeenCalledTimes(2)
    expect(imported).toHaveBeenCalledWith(
      {
        version: 1,
        complete: true,
        scope: { userId: 'source-user', workspaceId: 'source-workspace' },
        entries: [
          { encryptedValue: 'ciphertext', name: 'ALIAS' },
          { encryptedValue: 'ciphertext', name: 'TOKEN' },
        ],
      },
      { trusted: true, origin: 'durableProvenance.envelope' }
    )
    expect(imported).toHaveBeenCalledWith(
      {
        version: 1,
        complete: true,
        scope: { userId: 'other-user', workspaceId: 'source-workspace' },
        entries: [{ encryptedValue: 'ciphertext', name: 'TOKEN' }],
      },
      { trusted: true, origin: 'durableProvenance.envelope' }
    )
  })
})

describe('private durable provenance scope admission', () => {
  it('accepts a different source user in the authorized destination workspace', () => {
    expect(
      durableSecretProvenanceFromPrivateBundle(
        privateBundle({ userId: 'workflow-owner', workspaceId: 'workspace-1' }),
        'value',
        { userId: 'billing-actor', workspaceId: 'workspace-1' }
      )
    ).toEqual({
      status: 'exact',
      entries: [
        {
          name: 'TOKEN',
          encryptedValue: 'encrypted-token',
          sourceUserId: 'workflow-owner',
          sourceWorkspaceId: 'workspace-1',
        },
      ],
    })
  })

  it('admits workspace-scoped execution without fabricating a destination user', () => {
    expect(
      durableSecretProvenanceFromPrivateBundle(
        privateBundle({ userId: 'workflow-owner', workspaceId: 'workspace-1' }),
        'value',
        { workspaceId: 'workspace-1' }
      )
    ).toMatchObject({ status: 'exact' })
  })

  it('rejects a source from another or no workspace', () => {
    expect(
      durableSecretProvenanceFromPrivateBundle(
        privateBundle({ userId: 'workflow-owner', workspaceId: 'workspace-2' }),
        'value',
        { userId: 'billing-actor', workspaceId: 'workspace-1' }
      )
    ).toBeUndefined()
    expect(
      durableSecretProvenanceFromPrivateBundle(
        privateBundle({ userId: 'workflow-owner' }),
        'value',
        { userId: 'billing-actor', workspaceId: 'workspace-1' }
      )
    ).toBeUndefined()
    expect(
      durableSecretProvenanceFromPrivateBundle(privateBundle(), 'value', {
        userId: 'billing-actor',
        workspaceId: 'workspace-1',
      })
    ).toBeUndefined()
  })

  it('keeps workspace-less destinations isolated to the authenticated user', () => {
    expect(
      durableSecretProvenanceFromPrivateBundle(privateBundle({ userId: 'user-1' }), 'value', {
        userId: 'user-1',
      })
    ).toMatchObject({ status: 'exact' })
    expect(
      durableSecretProvenanceFromPrivateBundle(privateBundle({ userId: 'someone-else' }), 'value', {
        userId: 'user-1',
      })
    ).toBeUndefined()
    expect(
      durableSecretProvenanceFromPrivateBundle(
        privateBundle({ userId: 'user-1', workspaceId: 'workspace-1' }),
        'value',
        { userId: 'user-1' }
      )
    ).toBeUndefined()
  })
})

describe('importing unrecorded durable provenance', () => {
  const UNKNOWN = { status: 'unknown' } as const

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsEnforced.mockReturnValue(false)
  })

  it('warns and leaves the registry able to vouch when the surface is not enforced', async () => {
    const registry = new ResolvedSecretTraceRegistry()

    await expect(
      importDurableSecretProvenance(registry, UNKNOWN, undefined, 'memory')
    ).resolves.toBe(true)
    expect(registry.isPermanentlyIncomplete()).toBe(false)
    expect(mockReport).toHaveBeenCalledWith({
      surface: 'memory',
      cause: 'durable-provenance-unknown',
    })
  })

  it('latches the registry once that surface is closed', async () => {
    mockIsEnforced.mockReturnValue(true)
    const registry = new ResolvedSecretTraceRegistry()

    await expect(
      importDurableSecretProvenance(registry, UNKNOWN, undefined, 'memory')
    ).resolves.toBe(false)
    expect(registry.isPermanentlyIncomplete()).toBe(true)
    expect(mockReport).not.toHaveBeenCalled()
  })

  it('latches for a caller that has not declared a surface', async () => {
    const registry = new ResolvedSecretTraceRegistry()

    await expect(importDurableSecretProvenance(registry, UNKNOWN)).resolves.toBe(false)
    expect(registry.isPermanentlyIncomplete()).toBe(true)
  })

  it('never relaxes a malformed sidecar, which is a fault rather than missing data', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    const malformed = { status: 'exact', entries: [{ encryptedValue: '' }] } as never

    await expect(
      importDurableSecretProvenance(registry, malformed, undefined, 'memory')
    ).resolves.toBe(false)
    expect(registry.isPermanentlyIncomplete()).toBe(true)
    expect(mockReport).not.toHaveBeenCalled()
  })
})
