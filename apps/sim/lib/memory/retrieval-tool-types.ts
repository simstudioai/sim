import type { ProviderToolConfig } from '@/providers/types'
import type { ToolResponse } from '@/tools/types'

export const AGENT_MEMORY_RETRIEVAL_TOOL_ID = 'agent_memory_read'

export interface AgentMemoryRetrievalBinding {
  tool: ProviderToolConfig
  execute(params: Record<string, unknown>): Promise<ToolResponse>
}
