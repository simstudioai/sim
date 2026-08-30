/**
 * @vitest-environment node
 */
import { environmentUtilsMockFns, resetEnvironmentUtilsMock } from '@sim/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveEnvReferenceSecretArg } from '@/lib/mothership/tools/server/env-reference'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const scope = { userId: 'user-1', workspaceId: 'workspace-1' }

describe('resolveEnvReferenceSecretArg', () => {
  afterEach(resetEnvironmentUtilsMock)

  it('protects a password created after the turn registry was initialized', async () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)
    environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot.mockResolvedValueOnce({
      personalEncrypted: {},
      personalDecrypted: {},
      workspaceEncrypted: { CHAT_PASSWORD: 'encrypted-password' },
      workspaceDecrypted: { CHAT_PASSWORD: 'newly-created-password' },
      personalOwners: {},
      conflicts: [],
      decryptionFailures: [],
      workspaceUnredactedKeys: [],
    })

    expect(
      await resolveEnvReferenceSecretArg({
        ...scope,
        value: '{{CHAT_PASSWORD}}',
        argName: 'password',
        registry,
      })
    ).toEqual({ value: 'newly-created-password' })
    expect(registry.isComplete()).toBe(true)
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'newly-created-password', replacement: '{{CHAT_PASSWORD}}' },
    ])
  })

  it('does not resolve a removed password from the previous catalog', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'CHAT_PASSWORD', plaintext: 'old-password', encryptedValue: 'encrypted-old' }],
      scope
    )

    const result = await resolveEnvReferenceSecretArg({
      ...scope,
      value: '{{CHAT_PASSWORD}}',
      argName: 'password',
      registry,
    })

    expect(result).not.toHaveProperty('value')
    expect(result.error).toContain('not set')
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('leaves literal passwords alone without loading the environment', async () => {
    expect(
      await resolveEnvReferenceSecretArg({
        ...scope,
        value: '$literal_password',
        argName: 'password',
      })
    ).toEqual({ value: '$literal_password' })
    expect(environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot).not.toHaveBeenCalled()
  })
})
