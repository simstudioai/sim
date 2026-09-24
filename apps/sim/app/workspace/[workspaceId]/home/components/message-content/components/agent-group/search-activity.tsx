'use client'

import { useState } from 'react'
import { cn, OverflowText } from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import { toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import { ACTIVITY_LABEL_CLASS, ActivityStatus } from '@/components/ui/activity-status'
import {
  collectRetrievalCitationEvidence,
  parseCitationRecord,
} from '@/lib/mothership/chat/citation-evidence'
import { extractStreamingStringArgument } from '@/lib/mothership/tools/streaming-args'
import {
  getToolInProgressTitle,
  getToolStatusDisplayTitle,
  normalizeToolActivityDescription,
} from '@/lib/mothership/tools/tool-display'
import { ActivityDisclosure } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/activity-disclosure'
import { SearchActivityResults } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/search-activity-results'
import { indexSourcesByUrl } from '@/app/workspace/[workspaceId]/home/components/message-content/sources-by-url'
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

/**
 * What a finished search came to, as a header suffix in the " · N stopped"
 * style of tool group headers, so the outcome reads while the row is
 * collapsed. A described stop or skip already leads its title with the
 * outcome, so it gets no suffix. A failure stays silent and keeps the neutral
 * title tool rows give errored calls.
 */
function searchOutcome(
  tool: ToolCallData,
  described: boolean,
  resultCount: number,
  noResults: boolean
): string | undefined {
  switch (tool.status) {
    case ToolCallStatus.rejected:
      return 'declined'
    case ToolCallStatus.cancelled:
    case ToolCallStatus.interrupted:
      return described ? undefined : 'stopped'
    case ToolCallStatus.skipped:
      return described ? undefined : 'skipped'
    case ToolCallStatus.success:
      if (noResults) return 'no results'
      return resultCount > 0
        ? `${resultCount} ${resultCount === 1 ? 'result' : 'results'}`
        : undefined
    default:
      return undefined
  }
}

/**
 * The header title: the model's description of the call, in the tense and
 * outcome wording tool rows use, else the query text, else what the call is
 * doing. Tense follows liveness: a finished call reads as succeeded, stopped,
 * skipped, or in the neutral wording, never as still running.
 */
function searchTitle(
  tool: ToolCallData,
  description: string | undefined,
  queryText: string,
  working: boolean
): string {
  if (description) {
    const title = working ? getToolInProgressTitle : getToolStatusDisplayTitle
    return title(tool.displayTitle, tool.status, tool.toolName, description)
  }
  if (queryText) return queryText
  if (tool.toolName === 'search_sources') {
    return isToolDone(tool.status) ? 'Checked connected sources' : 'Checking connected sources'
  }
  return 'Preparing query'
}

interface SearchQueryActivityProps {
  tool: ToolCallData
  /** This row holds its lane's one live indicator. */
  isLive: boolean
}

/**
 * Each search call owns a stable result snapshot, so later searches never
 * replace it. A row is open while its call runs and closes once it finishes;
 * a toggle by the user sticks for that row.
 */
function SearchQueryActivity({ tool, isLive }: SearchQueryActivityProps) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null)
  const done = isToolDone(tool.status)
  const expanded = manualExpanded ?? !done
  const description = normalizeToolActivityDescription(tool.activityDescription)
  const queryText = searchQueries(tool).join(' · ')
  const evidence = collectRetrievalCitationEvidence([
    { toolCall: { name: tool.toolName, status: tool.status, result: tool.result } },
  ])
  const sources = [...indexSourcesByUrl(evidence.values()).values()]
  const output = parseCitationRecord(tool.result?.output)
  const data = parseCitationRecord(output?.data) ?? output
  const noResults = Boolean(
    tool.toolName === 'search_workspace' &&
      tool.status === ToolCallStatus.success &&
      tool.result?.success &&
      output?.success !== false &&
      Array.isArray(data?.results) &&
      data.results.length === 0
  )

  const title = searchTitle(tool, description, queryText, isLive || !done)
  const outcome = searchOutcome(tool, Boolean(description), sources.length, noResults)
  const showQuery = Boolean(description && queryText)

  return (
    <ActivityDisclosure
      header={
        <>
          <ActivityStatus
            label={title}
            isActive={isLive}
            icon={<Search className='size-[14px]' />}
          />
          {outcome && (
            <span className={cn('shrink-0 whitespace-pre', ACTIVITY_LABEL_CLASS)}>
              {` · ${outcome}`}
            </span>
          )}
        </>
      }
      expanded={expanded}
      onToggle={() => setManualExpanded(!expanded)}
      isStreaming={false}
      collapsible={showQuery || sources.length > 0}
      unbounded
    >
      <div className='ml-[7px] flex flex-col gap-1 border-[var(--border)] border-l pb-1 pl-4'>
        {showQuery && (
          <OverflowText label={queryText} className='text-[var(--text-muted)] text-caption' />
        )}
        {sources.length > 0 && (
          <SearchActivityResults sources={sources} query={queryText || title} />
        )}
      </div>
    </ActivityDisclosure>
  )
}

interface SearchActivityProps {
  tools: ToolCallData[]
  /** The call holding the lane's live indicator, which only a running search can be. */
  liveToolId?: string
}

/**
 * Search history and its results stay inspectable without changing the
 * selected panel. Only the row holding the lane's live call shimmers.
 */
export function SearchActivity({ tools, liveToolId }: SearchActivityProps) {
  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      {tools.map((tool) => (
        <SearchQueryActivity key={tool.id} tool={tool} isLive={tool.id === liveToolId} />
      ))}
    </div>
  )
}
