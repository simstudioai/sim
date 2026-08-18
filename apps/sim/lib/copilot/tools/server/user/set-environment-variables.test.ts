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
  setWorkspaceSecretMock,
} = vi.hoisted(() => ({
  ensureWorkflowAccessMock: vi.fn(),
  ensureWorkspaceAccessMock: vi.fn(),
  getDefaultWorkspaceIdMock: vi.fn(),
  setWorkspaceSecretMock: vi.fn(),
}))

vi.mock('@/lib/credentials/secret-values', () => ({
  setWorkspaceSecret: setWorkspaceSecretMock,
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
    setWorkspaceSecretMock.mockResolvedValue({ created: false, updatedAt: new Date() })
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

  it('describes a workspace secret through the same writer the Set Secret API uses', async () => {
    await setEnvironmentVariablesServerTool.execute(
      {
        variables: [
          { name: 'API_KEY', value: 'secret', description: '  Stripe live key  ' },
          { name: 'OTHER_KEY', value: 'other' },
        ],
      },
      { userId: 'user-1', workspaceId: 'ws-1' }
    )

    expect(setWorkspaceSecretMock).toHaveBeenCalledTimes(1)
    expect(setWorkspaceSecretMock).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      name: 'API_KEY',
      value: 'secret',
      userId: 'user-1',
      description: 'Stripe live key',
    })
    // The access-checked bulk write still runs first: it is what authorizes the
    // caller and mints the credential row a new key's description needs.
    expect(upsertWorkspaceEnvVarsMock.mock.invocationCallOrder[0]).toBeLessThan(
      setWorkspaceSecretMock.mock.invocationCallOrder[0]
    )
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

    expect(setWorkspaceSecretMock).toHaveBeenCalledTimes(1)
    expect(setWorkspaceSecretMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'API_KEY', description: null })
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
