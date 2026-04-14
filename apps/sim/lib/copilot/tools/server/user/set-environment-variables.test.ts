/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  ensureWorkflowAccessMock,
  ensureWorkspaceAccessMock,
  getDefaultWorkspaceIdMock,
  upsertPersonalEnvVarsMock,
  upsertWorkspaceEnvVarsMock,
} = vi.hoisted(() => ({
  ensureWorkflowAccessMock: vi.fn(),
  ensureWorkspaceAccessMock: vi.fn(),
  getDefaultWorkspaceIdMock: vi.fn(),
  upsertPersonalEnvVarsMock: vi.fn(),
  upsertWorkspaceEnvVarsMock: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('@/lib/copilot/tools/handlers/access', () => ({
  ensureWorkflowAccess: ensureWorkflowAccessMock,
  ensureWorkspaceAccess: ensureWorkspaceAccessMock,
  getDefaultWorkspaceId: getDefaultWorkspaceIdMock,
}))

vi.mock('@/lib/environment/utils', () => ({
  upsertPersonalEnvVars: upsertPersonalEnvVarsMock,
  upsertWorkspaceEnvVars: upsertWorkspaceEnvVarsMock,
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
})
