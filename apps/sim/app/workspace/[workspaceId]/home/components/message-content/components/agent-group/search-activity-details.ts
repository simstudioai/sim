import { collectRetrievalCitationEvidence } from '@/lib/mothership/chat/citation-evidence'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { indexSourcesByUrl } from '@/app/workspace/[workspaceId]/home/components/message-content/sources-by-url'
import type { ToolCallData } from '@/app/workspace/[workspaceId]/home/types'

/** Only searches with safe sources have displayable details. */
export function getSearchActivitySources(tool: ToolCallData): SourceTagData[] | undefined {
  if (tool.toolName !== 'search_workspace') return undefined
  const evidence = collectRetrievalCitationEvidence([
    { toolCall: { name: tool.toolName, status: tool.status, result: tool.result } },
  ])
  const sources = [...indexSourcesByUrl(evidence.values()).values()]
  return sources.length > 0 ? sources : undefined
}
