'use client'

import { useState } from 'react'
import { cn, OverflowText } from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import { toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import {
  collectRetrievalCitationEvidence,
  parseCitationRecord,
} from '@/lib/mothership/chat/citation-evidence'
import { extractStreamingStringArgument } from '@/lib/mothership/tools/streaming-args'
import { ActivityDisclosure } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/activity-disclosure'
import { SearchActivityResults } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/search-activity-results'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { isToolDone } from '@/app/workspace/[workspaceId]/home/components/message-content/utils'
import { type ToolCallData, ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

/** Source setup and approval keep their interactive tool presentation. */
export function isSearchActivityTool(tool: ToolCallData): boolean {
  return (
    tool.toolName === 'search_workspace' ||
    (tool.toolName === 'search_sources' &&
      ['list', 'get', 'providers'].includes(toStringOrNull(tool.params?.action) ?? ''))
  )
}

/** Show only query text, never account identifiers, cursors, or raw tool output. */
function searchQueries(tool: ToolCallData): string[] {
  const query =
    toStringOrNull(tool.params?.query) ??
    extractStreamingStringArgument(tool.streamingArgs, 'query')
  const nativeQueries = toArray(tool.params?.nativeQueries).flatMap((entry) => {
    const value = toStringOrNull(toRecord(entry).query)?.trim()
    return value ? [value] : []
  })
  return [...new Set([...(query?.trim() ? [query.trim()] : []), ...nativeQueries])]
}

function searchStatus(tool: ToolCallData): string | undefined {
  switch (tool.status) {
    case ToolCallStatus.error:
      return 'Search failed'
    case ToolCallStatus.rejected:
      return 'Search declined'
    case ToolCallStatus.cancelled:
    case ToolCallStatus.interrupted:
      return 'Search stopped'
    case ToolCallStatus.skipped:
      return 'Search skipped'
    default:
      return undefined
  }
}

interface SearchQueryActivityProps {
  tool: ToolCallData
}

/** Each search call owns a stable result snapshot, so later searches never replace it. */
function SearchQueryActivity({ tool }: SearchQueryActivityProps) {
  const [expanded, setExpanded] = useState(true)
  const queries = searchQueries(tool)
  const status = searchStatus(tool)
  const evidence = collectRetrievalCitationEvidence([
    { toolCall: { name: tool.toolName, status: tool.status, result: tool.result } },
  ])
  const byUrl = new Map<string, SourceTagData>()
  for (const source of evidence.values()) {
    if (!byUrl.has(source.url)) byUrl.set(source.url, source)
  }
  const sources = [...byUrl.values()]
  const output = parseCitationRecord(tool.result?.output)
  const data = parseCitationRecord(output?.data) ?? output
  const noResults =
    tool.toolName === 'search_workspace' &&
    tool.status === ToolCallStatus.success &&
    tool.result?.success &&
    output?.success !== false &&
    Array.isArray(data?.results) &&
    data.results.length === 0

  const label = queries.length
    ? queries.join(' · ')
    : tool.toolName === 'search_sources'
      ? isToolDone(tool.status)
        ? 'Checked connected sources'
        : 'Checking connected sources'
      : 'Preparing query'

  return (
    <ActivityDisclosure
      header={
        <span className='flex min-w-0 items-center gap-2 text-[var(--text-muted)] text-small'>
          <Search aria-hidden className='size-[14px] shrink-0 text-[var(--text-icon)]' />
          <OverflowText label={label} focusTarget='nearest-interactive' />
        </span>
      }
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      isStreaming={false}
      collapsible={sources.length > 0 || Boolean(status) || Boolean(noResults)}
      unbounded
    >
      <div className='ml-[7px] border-[var(--border)] border-l pb-2 pl-4'>
        {sources.length > 0 && <SearchActivityResults sources={sources} query={label} />}
        {noResults && (
          <span className='text-[var(--text-muted)] text-caption'>No results found</span>
        )}
        {status && (
          <span
            className={cn(
              'text-caption',
              tool.status === ToolCallStatus.error
                ? 'text-[var(--text-error)]'
                : 'text-[var(--text-muted)]'
            )}
          >
            {status}
          </span>
        )}
      </div>
    </ActivityDisclosure>
  )
}

interface SearchActivityProps {
  tools: ToolCallData[]
}

/** Search history and its results stay inspectable without changing the selected panel. */
export function SearchActivity({ tools }: SearchActivityProps) {
  return (
    <div className='flex min-w-0 flex-col gap-3'>
      {tools.map((tool) => (
        <SearchQueryActivity key={tool.id} tool={tool} />
      ))}
    </div>
  )
}
