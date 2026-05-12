import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMothershipToolsForRequest } from './runtime'

const { dbMock, getMothershipSettingsMock, mockRows } = vi.hoisted(() => {
  const mockRows: any[] = []
  const dbMock = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => mockRows),
          })),
        })),
      })),
    })),
  }
  const getMothershipSettingsMock = vi.fn(async (workspaceId: string) => ({
    workspaceId,
    mcpTools: [],
    customTools: [],
    skills: [],
  }))
  return { dbMock, getMothershipSettingsMock, mockRows }
})

vi.mock('@sim/db', () => ({
  db: dbMock,
  customTools: {
    id: 'customTools.id',
    workspaceId: 'customTools.workspaceId',
    title: 'customTools.title',
  },
  settings: {
    userId: 'settings.userId',
    superUserModeEnabled: 'settings.superUserModeEnabled',
  },
  skill: {
    id: 'skill.id',
    workspaceId: 'skill.workspaceId',
    name: 'skill.name',
    description: 'skill.description',
  },
  user: {
    id: 'user.id',
    role: 'user.role',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
}))

vi.mock('@/lib/mcp/utils', () => ({
  createMcpToolId: (serverId: string, toolName: string) => `${serverId}_${toolName}`,
}))

vi.mock('@/executor/constants', () => ({
  AGENT: { CUSTOM_TOOL_PREFIX: 'custom_' },
}))

vi.mock('./operations', () => ({
  getMothershipSettings: getMothershipSettingsMock,
}))

describe('buildMothershipToolsForRequest', () => {
  beforeEach(() => {
    mockRows.length = 0
    dbMock.select.mockClear()
    getMothershipSettingsMock.mockClear()
  })

  it('does not expose configured tools to non-superusers', async () => {
    mockRows.push({ role: 'user', superUserModeEnabled: true })

    await expect(
      buildMothershipToolsForRequest({ workspaceId: 'workspace-1', userId: 'user-1' })
    ).resolves.toEqual({ tools: [] })

    expect(getMothershipSettingsMock).not.toHaveBeenCalled()
  })

  it('loads workspace settings for effective superusers', async () => {
    mockRows.push({ role: 'admin', superUserModeEnabled: true })

    await buildMothershipToolsForRequest({ workspaceId: 'workspace-1', userId: 'admin-1' })

    expect(getMothershipSettingsMock).toHaveBeenCalledWith('workspace-1')
  })
})
