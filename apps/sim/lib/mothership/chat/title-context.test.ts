import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildChatTitleContext } from '@/lib/mothership/chat/title-context'

const { getWorkspace, listWorkspaces } = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
}))
vi.mock('@/lib/workspaces/application/get-public-workspace', () => ({
  getPublicWorkspace: { execute: getWorkspace },
}))
vi.mock('@/lib/workspaces/application/list-organization-workspaces', () => ({
  listOrganizationWorkspaces: { execute: listWorkspaces },
}))
const inventory = {
  workflows: [{ id: 'workflow', name: 'Invoice approval', deployed: true }],
  tables: [{ id: 'table', name: 'Customers' }],
  knowledgeBases: [],
  files: [{ path: 'invoice.csv' }],
  skills: [],
  customTools: [],
  mcpServers: [],
  credentials: [{ id: 'credential', name: 'SECRET CREDENTIAL' }],
  secrets: ['SECRET NAME'],
  truncated: [],
}

describe('buildChatTitleContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getWorkspace.mockResolvedValue({ workspace: { name: 'Finance' } })
  })

  it('reuses prepared or recovered inventory names after current workspace authorization', async () => {
    const result = await buildChatTitleContext({
      userId: 'user',
      workspaceId: 'workspace',
      inventory,
    })
    expect(JSON.parse(result!)).toEqual({
      scope: 'workspace',
      workspaceName: 'Finance',
      partial: true,
      resources: { workflows: ['Invoice approval'], tables: ['Customers'], files: ['invoice.csv'] },
    })
    expect(result).not.toContain('SECRET')
    expect(getWorkspace).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        subjectUserId: 'user',
        workspaceId: 'workspace',
        audience: 'sim:workspaces',
      }),
      input: { workspaceId: 'workspace' },
    })
    expect(listWorkspaces).not.toHaveBeenCalled()
  })

  it('uses a bounded authorized org listing and never fans out into workspace inventories', async () => {
    listWorkspaces.mockResolvedValue({ workspaces: [{ name: 'Marketing', id: 'hidden-id' }] })
    const result = await buildChatTitleContext({
      userId: 'user',
      organizationId: 'org',
      chatId: 'chat',
      inventory,
    })
    expect(JSON.parse(result!)).toEqual({
      scope: 'organization',
      partial: true,
      resources: { workspaces: ['Marketing'] },
    })
    expect(listWorkspaces).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        subjectUserId: 'user',
        organizationId: 'org',
        resourceScope: { chatId: 'chat' },
        audience: 'sim:workspaces',
      }),
      input: { organizationId: 'org', limit: 12 },
    })
    expect(getWorkspace).not.toHaveBeenCalled()
  })

  it('omits metadata on revoked access, including previously prepared inventory', async () => {
    getWorkspace.mockRejectedValueOnce(new Error('forbidden'))
    expect(
      await buildChatTitleContext({ userId: 'user', workspaceId: 'workspace', inventory })
    ).toBeUndefined()
  })

  it('bounds escaped names and excludes all unprojected fields', async () => {
    const names = Array.from({ length: 100 }, () => ({
      id: 'id',
      name: '\u0000'.repeat(500),
      deployed: true,
    }))
    const result = await buildChatTitleContext({
      userId: 'user',
      workspaceId: 'workspace',
      inventory: {
        ...inventory,
        workflows: names,
        tables: names,
        knowledgeBases: names,
        body: 'PRIVATE BODY',
        inputSchema: { secret: 'PRIVATE SCHEMA' },
      },
    })
    expect(result!.length).toBeLessThanOrEqual(6000)
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(result).not.toContain('PRIVATE')
  })

  it('does not invent authority for missing owners or ambiguous scope', async () => {
    expect(await buildChatTitleContext({ workspaceId: 'workspace', inventory })).toBeUndefined()
    expect(
      await buildChatTitleContext({
        userId: 'user',
        workspaceId: 'workspace',
        organizationId: 'org',
      })
    ).toBeUndefined()
    expect(getWorkspace).not.toHaveBeenCalled()
  })
})
