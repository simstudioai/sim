'use client'

import type { SimSearchSlackResult } from '@/lib/api/contracts/knowledge'
import { matchSnippet } from '@/lib/knowledge/search/snippet'
import { SourceCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card'
import {
  isHttpUrl,
  type SourceTagData,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { useSimSearchSlack } from '@/hooks/queries/kb/knowledge'

function toSource(result: SimSearchSlackResult, query: string): SourceTagData | null {
  if (!isHttpUrl(result.permalink)) return null
  return {
    url: result.permalink,
    title: `#${result.channelName}`,
    siteName: 'Slack',
    connectorType: 'slack',
    snippet: matchSnippet(result.text, query),
    author: result.authorName,
    updatedAt: result.sentAt ?? undefined,
  }
}

interface SlackSearchResultsProps {
  workspaceId: string
  query: string
  /** Asks the agent about one message; the prompt names it and links to it. */
  onSummarize: (prompt: string) => void
}

/**
 * Slack messages matching the query, searched live as the signed-in person.
 *
 * Its own group rather than blended into the indexed results: Slack ranks with
 * its own relevance, which is not comparable to a vector distance, so
 * interleaving the two lists would present an ordering that means nothing.
 * Nothing renders while Slack is unconnected — the Sources strip is where a
 * person connects it — but a connection that stopped working says so, because
 * reconnecting is something they can act on.
 */
export function SlackSearchResults({ workspaceId, query, onSummarize }: SlackSearchResultsProps) {
  const { data, isPending, isPlaceholderData } = useSimSearchSlack(workspaceId, query)

  if (!data || isPending || isPlaceholderData) return null
  if (data.status === 'not_connected') return null

  if (data.status === 'needs_reauth') {
    return (
      <p className='px-2 py-2 text-[var(--text-muted)] text-caption'>
        Reconnect Slack from Sources to search it.
      </p>
    )
  }
  if (data.status === 'unavailable') {
    return (
      <p className='px-2 py-2 text-[var(--text-muted)] text-caption'>
        Slack could not be searched this time.
      </p>
    )
  }
  if (data.results.length === 0) return null

  return (
    <div className='flex flex-col'>
      <p className='px-2 py-2 text-[var(--text-muted)] text-caption'>
        <span className='tabular-nums'>
          {data.results.length === 1 ? '1 Slack message' : `${data.results.length} Slack messages`}
        </span>
        {' · searched in Slack as you'}
      </p>
      {data.results.map((result) => {
        const source = toSource(result, query)
        return source ? (
          <SourceCard
            key={`${result.channelId}:${result.messageTs}`}
            source={source}
            query={query}
            onSummarize={(cited) =>
              onSummarize(`Summarize this Slack message from ${cited.title} (${cited.url})`)
            }
          />
        ) : null
      })}
    </div>
  )
}
