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
} from '@/lib/execution/durable-secret-provenance'
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
