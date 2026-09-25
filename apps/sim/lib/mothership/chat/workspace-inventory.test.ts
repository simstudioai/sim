import { knowledgeBaseUseCasesMock } from '@sim/testing/mocks/knowledge-base-use-cases.mock'
import { mcpUseCasesMock } from '@sim/testing/mocks/mcp-use-cases.mock'
import { secretsUseCasesMock } from '@sim/testing/mocks/secrets-use-cases.mock'
import { tableApplicationTablesMock } from '@sim/testing/mocks/table-application-tables.mock'
import { workspaceFilesListMock } from '@sim/testing/mocks/workspace-files-list.mock'
import { describe, expect, it, vi } from 'vitest'

const { pages } = vi.hoisted(() => {
  const page = (body: Record<string, unknown>) => ({ execute: vi.fn(async () => body) })
  return {
    pages: {
      workflows: page({
        workflows: [{ id: 'wf-1', name: 'Lead Scorer', folderPath: '/Sales', isDeployed: true }],
        nextCursorKeys: null,
      }),
      skills: page({ skills: [{ name: 'research' }], hasMore: false }),
      customTools: page({ tools: [{ id: 'ct-1', title: 'Lookup' }] }),
      credentials: page({
        credentials: [
          { id: 'cred-1', displayName: 'Slack bot', providerId: 'slack', type: 'service_account' },
        ],
        nextCursorKeys: null,
      }),
    },
  }
})

vi.mock('@/lib/workflows/application/list-workflows', () => ({ listWorkflows: pages.workflows }))
vi.mock('@/lib/table/application/tables', () => tableApplicationTablesMock)
vi.mock('@/lib/knowledge/application/knowledge-bases', () => knowledgeBaseUseCasesMock)
vi.mock('@/lib/workspace-files/application/list-workspace-files', () => workspaceFilesListMock)
vi.mock('@/lib/skills/application/use-cases', () => ({ listSkillsUseCase: pages.skills }))
vi.mock('@/lib/custom-tools/application/use-cases', () => ({
  listWorkspaceCustomToolsUseCase: pages.customTools,
}))
vi.mock('@/lib/mcp/application/use-cases', () => mcpUseCasesMock)
vi.mock('@/lib/credentials/application/list-workspace-credentials', () => ({
  listWorkspaceCredentials: pages.credentials,
}))
vi.mock('@/lib/secrets/application/use-cases', () => secretsUseCasesMock)

import { buildWorkspaceInventory } from '@/lib/mothership/chat/workspace-inventory'

const mocks = {
  ...pages,
  tables: tableApplicationTablesMock.listTablesUseCase,
  knowledge: knowledgeBaseUseCasesMock.listKnowledgeBases,
  files: workspaceFilesListMock.queryWorkspaceFilePage,
  mcp: mcpUseCasesMock.listMcpServersUseCase,
  secrets: secretsUseCasesMock.listSecretsUseCase,
}
mocks.tables.execute.mockImplementation(async () => ({
  tables: [{ table: { id: 'tbl_1', name: 'leads' } }],
  nextKeys: ['x'],
}))
mocks.knowledge.execute.mockImplementation(async () => ({
  knowledgeBases: [{ knowledgeBase: { id: 'kb-1', name: 'Docs' } }],
}))
mocks.files.execute.mockImplementation(async () => ({
  files: [{ id: 'wf_a', name: 'q3.md', folderPath: '/Reports', size: 12 }],
  nextKeys: null,
}))
mocks.mcp.execute.mockImplementation(async () => ({ servers: [{ id: 'mcp-1', name: 'GitHub' }] }))
mocks.secrets.execute.mockImplementation(async () => ({
  secrets: [{ envKey: 'OPENAI_API_KEY', displayName: 'openai' }],
  nextCursorKeys: null,
}))

describe('buildWorkspaceInventory', () => {
  it('reads every world under the caller principal, by name and id, and names the capped worlds', async () => {
    const principal = { kind: 'session', userId: 'user-1', sessionId: 's-1' } as const
    const inventory = await buildWorkspaceInventory(principal, 'ws-1')
    expect(inventory.workflows).toEqual([
      { id: 'wf-1', name: 'Lead Scorer', folder: '/Sales', deployed: true },
    ])
    expect(inventory.tables).toEqual([{ id: 'tbl_1', name: 'leads' }])
    expect(inventory.files).toEqual([{ path: 'files/Reports/q3.md', size: 12 }])
    expect(inventory.credentials).toEqual([
      { id: 'cred-1', name: 'Slack bot', provider: 'slack', type: 'service_account' },
    ])
    expect(inventory.secrets).toEqual(['OPENAI_API_KEY'])
    expect(inventory.truncated).toEqual(['tables'])
    expect(mocks.workflows.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        input: expect.objectContaining({ workspaceId: 'ws-1' }),
      })
    )
  })

  it('leaves a world empty when its listing fails, rather than failing the turn', async () => {
    mocks.mcp.execute.mockRejectedValueOnce(new Error('mcp down'))
    const inventory = await buildWorkspaceInventory(
      { kind: 'session', userId: 'u', sessionId: 's' },
      'ws-1'
    )
    expect(inventory.mcpServers).toEqual([])
    expect(inventory.workflows).toHaveLength(1)
  })
})
