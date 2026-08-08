/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getKnowledgeBase: vi.fn(),
  loadWorkspace: vi.fn(),
}))

vi.mock('@/lib/knowledge/service', () => ({ getKnowledgeBaseById: mocks.getKnowledgeBase }))
vi.mock('@/lib/knowledge/documents/service', () => ({ getKnowledgeDocument: vi.fn() }))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

import {
  resolveActiveKnowledgeBaseContext,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-user-1',
}
const knowledgeBase = { id: 'knowledge-1', workspaceId: 'workspace-1' }

describe('knowledge application contexts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getKnowledgeBase.mockResolvedValue(knowledgeBase)
    mocks.loadWorkspace.mockResolvedValue(workspace)
  })

  it('uses the canonical active-workspace loader', async () => {
    await expect(resolveKnowledgeWorkspaceContext({ workspaceId: 'workspace-1' })).resolves.toBe(
      workspace
    )
    expect(mocks.loadWorkspace).toHaveBeenCalledWith('workspace-1')
  })

  it('conceals an inactive canonical workspace as knowledge-base absence', async () => {
    mocks.loadWorkspace.mockResolvedValueOnce(null)

    await expect(
      resolveActiveKnowledgeBaseContext({ knowledgeBaseId: 'knowledge-1' })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Knowledge base not found' })
  })

  it('propagates canonical workspace database failures', async () => {
    const failure = new Error('workspace database unavailable')
    mocks.loadWorkspace.mockRejectedValueOnce(failure)

    await expect(
      resolveActiveKnowledgeBaseContext({ knowledgeBaseId: 'knowledge-1' })
    ).rejects.toBe(failure)
  })
})
