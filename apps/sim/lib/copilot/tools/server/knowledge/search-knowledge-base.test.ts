/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { executeKnowledgeBase } = vi.hoisted(() => ({ executeKnowledgeBase: vi.fn() }))

vi.mock('@/lib/copilot/generated/tool-catalog-v1', () => ({
  SearchKnowledgeBase: { id: 'search_knowledge_base' },
}))
vi.mock('@/lib/copilot/tools/server/knowledge/knowledge-base', () => ({
  knowledgeBaseServerTool: { execute: executeKnowledgeBase },
}))

import { searchKnowledgeBaseServerTool } from '@/lib/copilot/tools/server/knowledge/search-knowledge-base'

describe('search_knowledge_base delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['get', 'query', 'list_tags'])(
    'forwards %s with the immutable trusted context',
    async (operation) => {
      const params = { operation, args: { knowledgeBaseId: 'kb-1' } }
      const context = {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        chatId: 'chat-1',
        toolCallId: 'tool-1',
        copilotToolExecution: true,
      }
      executeKnowledgeBase.mockResolvedValueOnce({ success: true, message: 'ok' })

      await expect(searchKnowledgeBaseServerTool.execute(params, context)).resolves.toEqual({
        success: true,
        message: 'ok',
      })
      expect(executeKnowledgeBase).toHaveBeenCalledWith(params, context)
    }
  )

  it.each([
    'create',
    'add_file',
    'update',
    'delete',
    'delete_document',
    'update_document',
    'create_tag',
    'update_tag',
    'delete_tag',
    'add_connector',
    'update_connector',
    'delete_connector',
    'sync_connector',
    'unknown',
  ])('refuses %s before entering any knowledge application operation', async (operation) => {
    const result = await searchKnowledgeBaseServerTool.execute(
      { operation, args: { knowledgeBaseId: 'kb-1' } },
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        toolCallId: 'tool-1',
        copilotToolExecution: true,
      }
    )

    expect(result.success).toBe(false)
    expect(result.message).toContain('read-only')
    expect(executeKnowledgeBase).not.toHaveBeenCalled()
  })
})
