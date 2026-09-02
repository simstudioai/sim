import { afterEach, describe, expect, it } from 'vitest'
import {
  environmentUtilsMock,
  environmentUtilsMockFns,
  resetEnvironmentUtilsMock,
} from './environment-utils.mock'

describe('environment-utils mock', () => {
  afterEach(() => {
    resetEnvironmentUtilsMock()
  })

  /**
   * The default must carry EVERY field of the real `EnvironmentResolutionSnapshot`,
   * including `personalOwners` and `workspaceUnredactedKeys`. A mirror that omits
   * one lets a mocked snapshot reach production code as `undefined` and fail
   * there instead of in the assertion, which is the opposite of what a default
   * should do.
   */
  it('defaults model a user with no environment variables', async () => {
    await expect(environmentUtilsMock.getEnvironmentVariableKeys('user-1')).resolves.toEqual({
      variableNames: [],
      count: 0,
    })
    await expect(environmentUtilsMock.getEffectiveDecryptedEnv('user-1')).resolves.toEqual({})
    await expect(environmentUtilsMock.getPersonalAndWorkspaceEnv('user-1')).resolves.toEqual({
      personalEncrypted: {},
      workspaceEncrypted: {},
      personalDecrypted: {},
      workspaceDecrypted: {},
      personalOwners: {},
      conflicts: [],
      decryptionFailures: [],
      workspaceUnredactedKeys: [],
    })
    await expect(environmentUtilsMock.getEffectiveEnvironmentSnapshot('user-1')).resolves.toEqual({
      personalEncrypted: {},
      workspaceEncrypted: {},
      personalDecrypted: {},
      workspaceDecrypted: {},
      personalOwners: {},
      conflicts: [],
      decryptionFailures: [],
      workspaceUnredactedKeys: [],
    })
    await expect(
      environmentUtilsMock.getEffectiveEnvironmentVariableNames('user-1')
    ).resolves.toEqual([])
    await expect(
      environmentUtilsMock.resolveEffectiveEnvironmentVariables('user-1', 'ws-1', ['API_KEY'])
    ).resolves.toEqual({})
    await expect(environmentUtilsMock.upsertPersonalEnvVars('user-1', {})).resolves.toEqual({
      added: [],
      updated: [],
    })
    await expect(
      environmentUtilsMock.upsertWorkspaceEnvVars('ws-1', {}, 'user-1')
    ).resolves.toEqual([])
  })

  it('resetEnvironmentUtilsMock restores defaults after overrides', async () => {
    environmentUtilsMockFns.mockGetEffectiveDecryptedEnv.mockResolvedValue({ API_KEY: 'k' })
    await expect(environmentUtilsMock.getEffectiveDecryptedEnv('user-1')).resolves.toEqual({
      API_KEY: 'k',
    })
    resetEnvironmentUtilsMock()
    await expect(environmentUtilsMock.getEffectiveDecryptedEnv('user-1')).resolves.toEqual({})
  })
})
