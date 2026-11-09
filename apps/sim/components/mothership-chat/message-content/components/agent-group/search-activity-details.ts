import type { SourceTagData } from '@/components/mothership-chat/message-content/components/special-tags'
import { indexSourcesByUrl } from '@/components/mothership-chat/message-content/sources-by-url'
import { collectRetrievalCitationEvidence } from '@/lib/mothership/chat/citation-evidence'
import type { ToolCallData } from '@/lib/mothership/chat/types'

/** Only searches with safe sources have displayable details, for connected sources and the web alike. */
export function getSearchActivitySources(tool: ToolCallData): SourceTagData[] | undefined {
  if (tool.toolName !== 'search_workspace' && tool.toolName !== 'web_search') return undefined
  const evidence = collectRetrievalCitationEvidence([
    { toolCall: { name: tool.toolName, status: tool.status, result: tool.result } },
  ])
  const sources = [...indexSourcesByUrl(evidence.values()).values()]
  return sources.length > 0 ? sources : undefined
}
