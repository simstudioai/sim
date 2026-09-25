import {
  collectRetrievalCitationEvidence,
  parseCitationRecord,
} from '@/lib/mothership/chat/citation-evidence'
import { SearchActivityResults } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/search-activity-results'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { indexSourcesByUrl } from '@/app/workspace/[workspaceId]/home/components/message-content/sources-by-url'
import { type ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

/** Safe sources, an explicit empty result, or no displayable search details. */
export function getSearchActivitySources(tool: ToolCallData): SourceTagData[] | undefined {
  if (tool.toolName !== 'search_workspace') return undefined
  const evidence = collectRetrievalCitationEvidence([
    { toolCall: { name: tool.toolName, status: tool.status, result: tool.result } },
  ])
  const sources = [...indexSourcesByUrl(evidence.values()).values()]
  const output = parseCitationRecord(tool.result?.output)
  const data = parseCitationRecord(output?.data) ?? output
  const noResults = Boolean(
    tool.status === ToolCallStatus.success &&
      tool.result?.success &&
      output?.success !== false &&
      parseCitationRecord(data?.retrieval)?.status !== 'partial' &&
      Array.isArray(data?.results) &&
      data.results.length === 0
  )

  return sources.length > 0 || noResults ? sources : undefined
}

interface SearchActivityDetailsProps {
  sources: SourceTagData[]
  label: string
}

/** Per-call evidence stays in the shared activity history, never in the live header. */
export function SearchActivityDetails({ sources, label }: SearchActivityDetailsProps) {
  return sources.length > 0 ? (
    <SearchActivityResults sources={sources} label={label} />
  ) : (
    <p className='text-[var(--text-muted)] text-caption'>No results</p>
  )
}
