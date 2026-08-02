/**
 * @vitest-environment node
 */
import { environmentUtilsMockFns, resetEnvironmentUtilsMock } from '@sim/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareCopilotEnvironmentContext } from '@/lib/copilot/environment-context'

describe('prepareCopilotEnvironmentContext', () => {
  afterEach(() => {
    resetEnvironmentUtilsMock()
  })

  it('keeps decrypted values only in the inert provenance registry', async () => {
    environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot.mockResolvedValue({
      personalEncrypted: {
        SHARED_SECRET: 'personal-encrypted',
        PERSONAL_ONLY: 'personal-only-encrypted',
      },
      workspaceEncrypted: {
        SHARED_SECRET: 'workspace-encrypted',
        WORKSPACE_ONLY: 'workspace-only-encrypted',
      },
      personalDecrypted: {
        SHARED_SECRET: 'personal-value',
        PERSONAL_ONLY: 'personal-only-value',
      },
      workspaceDecrypted: {
        SHARED_SECRET: 'workspace-value',
        WORKSPACE_ONLY: 'workspace-only-value',
      },
      conflicts: ['SHARED_SECRET'],
      decryptionFailures: [],
    })

    const context = await prepareCopilotEnvironmentContext('user-1', 'workspace-1')

    expect(context).not.toHaveProperty('decryptedEnvVars')
    expect(context.resolvedSecretTraceRegistry.isComplete()).toBe(true)
    expect(
      context.resolvedSecretTraceRegistry.recordResolved('SHARED_SECRET', 'workspace-value')
    ).toBe(true)
    expect(context.resolvedSecretTraceRegistry.getActiveMatches()).toEqual([
      { plaintext: 'workspace-value', replacement: '{{SHARED_SECRET}}' },
    ])
    expect(
      environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot
    ).toHaveBeenCalledExactlyOnceWith('user-1', 'workspace-1')
  })
})
