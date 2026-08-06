/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  durableSecretProvenanceFromPrivateBundle,
  filterDurableSecretProvenanceBySourceValues,
  hashDurableSecretProvenanceValue,
} from '@/lib/execution/durable-secret-provenance'

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
