/**
 * @vitest-environment node
 */

import { environmentUtilsMockFns, resetEnvironmentUtilsMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockUpsertPersonalEnvVars: upsertPersonalEnvVarsMock,
  mockUpsertWorkspaceEnvVars: upsertWorkspaceEnvVarsMock,
} = environmentUtilsMockFns

afterAll(resetEnvironmentUtilsMock)

const {
  ensureWorkflowAccessMock,
  ensureWorkspaceAccessMock,
  getDefaultWorkspaceIdMock,
  listCredentialsMock,
  performUpdateCredentialMock,
} = vi.hoisted(() => ({
  ensureWorkflowAccessMock: vi.fn(),
  ensureWorkspaceAccessMock: vi.fn(),
  getDefaultWorkspaceIdMock: vi.fn(),
  listCredentialsMock: vi.fn(),
  performUpdateCredentialMock: vi.fn(),
}))

vi.mock('@/lib/credentials/queries', () => ({
  listVisibleWorkspaceCredentials: listCredentialsMock,
}))

vi.mock('@/lib/credentials/orchestration', () => ({
  performUpdateCredential: performUpdateCredentialMock,
}))

vi.mock('@/lib/copilot/tools/handlers/access', () => ({
  ensureWorkflowAccess: ensureWorkflowAccessMock,
  ensureWorkspaceAccess: ensureWorkspaceAccessMock,
  getDefaultWorkspaceId: getDefaultWorkspaceIdMock,
}))

import { setEnvironmentVariablesServerTool } from './set-environment-variables'

describe('setEnvironmentVariablesServerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: { id: 'wf-1', workspaceId: 'ws-from-workflow' },
    })
    ensureWorkspaceAccessMock.mockResolvedValue(undefined)
    getDefaultWorkspaceIdMock.mockResolvedValue('ws-default')
    upsertPersonalEnvVarsMock.mockResolvedValue({ added: ['API_KEY'], updated: [] })
    upsertWorkspaceEnvVarsMock.mockResolvedValue(['API_KEY'])
    listCredentialsMock.mockResolvedValue({
      data: [
        { id: 'cred-api', envKey: 'API_KEY' },
        { id: 'cred-other', envKey: 'OTHER_KEY' },
      ],
    })
    performUpdateCredentialMock.mockResolvedValue({ success: true })
  })

  it('defaults to workspace scope and uses the current workspace context', async () => {
    const result = await setEnvironmentVariablesServerTool.execute(
      {
        variables: [{ name: 'API_KEY', value: 'secret' }],
      },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
      }
    )

    expect(ensureWorkspaceAccessMock).toHaveBeenCalledWith('ws-1', 'user-1', 'write')
    expect(upsertWorkspaceEnvVarsMock).toHaveBeenCalledWith('ws-1', { API_KEY: 'secret' }, 'user-1')
    expect(upsertPersonalEnvVarsMock).not.toHaveBeenCalled()
    expect(result.scope).toBe('workspace')
    expect(result.workspaceId).toBe('ws-1')
  })

  it('supports explicit personal scope', async () => {
    const result = await setEnvironmentVariablesServerTool.execute(
      {
        scope: 'personal',
        variables: [{ name: 'API_KEY', value: 'secret' }],
      },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
      }
    )

    expect(upsertPersonalEnvVarsMock).toHaveBeenCalledWith('user-1', { API_KEY: 'secret' })
    expect(upsertWorkspaceEnvVarsMock).not.toHaveBeenCalled()
    expect(ensureWorkspaceAccessMock).not.toHaveBeenCalled()
    expect(result.scope).toBe('personal')
  })

  it('falls back to the default workspace when none is in context', async () => {
    await setEnvironmentVariablesServerTool.execute(
      {
        variables: [{ name: 'API_KEY', value: 'secret' }],
      },
      {
        userId: 'user-1',
      }
    )

    expect(getDefaultWorkspaceIdMock).toHaveBeenCalledWith('user-1')
    expect(upsertWorkspaceEnvVarsMock).toHaveBeenCalledWith(
      'ws-default',
      { API_KEY: 'secret' },
      'user-1'
    )
  })

  it('describes a workspace secret through the credential update handler, never rewriting its value', async () => {
    await setEnvironmentVariablesServerTool.execute(
      {
        variables: [
          { name: 'API_KEY', value: 'secret', description: '  Stripe live key  ' },
          { name: 'OTHER_KEY', value: 'other' },
        ],
      },
      { userId: 'user-1', workspaceId: 'ws-1' }
    )

    expect(performUpdateCredentialMock).toHaveBeenCalledTimes(1)
    expect(performUpdateCredentialMock).toHaveBeenCalledWith({
      credentialId: 'cred-api',
      userId: 'user-1',
      description: 'Stripe live key',
      allowedTypes: ['env_workspace'],
    })
    // The access-checked value write runs first: it authorizes the caller and
    // mints the credential row a new key's description hangs on.
    expect(upsertWorkspaceEnvVarsMock.mock.invocationCallOrder[0]).toBeLessThan(
      performUpdateCredentialMock.mock.invocationCallOrder[0]
    )
  })

  it('describes a secret that already exists without touching its value', async () => {
    const result = await setEnvironmentVariablesServerTool.execute(
      { variables: [{ name: 'API_KEY', description: 'Stripe live key' }] },
      { userId: 'user-1', workspaceId: 'ws-1' }
    )

    // Nothing is written to the secret itself: coercing the absent value to ''
    // would blank the very secret the model is annotating.
    expect(upsertWorkspaceEnvVarsMock).toHaveBeenCalledWith('ws-1', {}, 'user-1')
    expect(performUpdateCredentialMock).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: 'cred-api', description: 'Stripe live key' })
    )
    expect(result.describedVariables).toEqual(['API_KEY'])
  })

  it('keeps a stored value reported when its description fails', async () => {
    performUpdateCredentialMock.mockResolvedValue({ success: false, error: 'Forbidden' })

    const result = await setEnvironmentVariablesServerTool.execute(
      { variables: [{ name: 'API_KEY', value: 'secret', description: 'Stripe live key' }] },
      { userId: 'user-1', workspaceId: 'ws-1' }
    )

    expect(result.workspaceUpdatedVariables).toEqual(['API_KEY'])
    expect(result.describedVariables).toEqual([])
    expect(result.message).toContain('API_KEY: Forbidden')
  })

  it('fails a describe-only call that saved nothing', async () => {
    performUpdateCredentialMock.mockResolvedValue({ success: false, error: 'Forbidden' })
    upsertWorkspaceEnvVarsMock.mockResolvedValue([])

    await expect(
      setEnvironmentVariablesServerTool.execute(
        { variables: [{ name: 'API_KEY', description: 'Stripe live key' }] },
        { userId: 'user-1', workspaceId: 'ws-1' }
      )
    ).rejects.toThrow('Could not describe: API_KEY: Forbidden')
  })

  it('clears a description sent blank and leaves an omitted one alone', async () => {
    await setEnvironmentVariablesServerTool.execute(
      {
        variables: [
          { name: 'API_KEY', value: 'secret', description: '   ' },
          { name: 'OTHER_KEY', value: 'other' },
        ],
      },
      { userId: 'user-1', workspaceId: 'ws-1' }
    )

    expect(performUpdateCredentialMock).toHaveBeenCalledTimes(1)
    expect(performUpdateCredentialMock).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: 'cred-api', description: null })
    )
  })

  it('rejects a description on a personal secret', async () => {
    await expect(
      setEnvironmentVariablesServerTool.execute(
        {
          scope: 'personal',
          variables: [{ name: 'API_KEY', value: 'secret', description: 'my key' }],
        },
        { userId: 'user-1', workspaceId: 'ws-1' }
      )
    ).rejects.toThrow('description is only supported for a workspace secret')

    expect(upsertPersonalEnvVarsMock).not.toHaveBeenCalled()
  })

  it('rejects a description longer than the secret detail form allows', async () => {
    await expect(
      setEnvironmentVariablesServerTool.execute(
        { variables: [{ name: 'API_KEY', value: 'secret', description: 'a'.repeat(501) }] },
        { userId: 'user-1', workspaceId: 'ws-1' }
      )
    ).rejects.toThrow('description for API_KEY must be at most 500 characters')

    expect(upsertWorkspaceEnvVarsMock).not.toHaveBeenCalled()
  })
})
