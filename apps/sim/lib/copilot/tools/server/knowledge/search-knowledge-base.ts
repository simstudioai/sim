import { SearchKnowledgeBase } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { knowledgeBaseServerTool } from '@/lib/copilot/tools/server/knowledge/knowledge-base'

type SearchKnowledgeBaseArgs = {
  operation: string
  args?: Record<string, any>
}

type SearchKnowledgeBaseResult = {
  success: boolean
  message: string
  data?: any
}

const READ_OPERATIONS = new Set(['get', 'query', 'list_tags'])

/**
 * Read-only variant of knowledge_base for info-gathering agents. Copilot
 * access control is a per-agent tool allowlist, so read-only access gets its
 * own tool name with its own operation contract — enforced here (where
 * execution happens) on top of the fail-fast guard in the Go executor.
 */
export const searchKnowledgeBaseServerTool: BaseServerTool<
  SearchKnowledgeBaseArgs,
  SearchKnowledgeBaseResult
> = {
  name: SearchKnowledgeBase.id,
  async execute(params: SearchKnowledgeBaseArgs, context?: ServerToolContext) {
    const operation = params?.operation
    if (!READ_OPERATIONS.has(operation)) {
      return {
        success: false,
        message: `search_knowledge_base is read-only: operation '${operation}' is not available (allowed: get, list_tags, query); mutations go through the knowledge agent's knowledge_base tool`,
      }
    }
    return knowledgeBaseServerTool.execute(params, context)
  },
}
