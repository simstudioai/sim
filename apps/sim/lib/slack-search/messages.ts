import { truncate } from '@sim/utils/string'
import type { SlackJsonObject, SlackMessage } from '@/lib/internal/slack/client'
import type { KnowledgeSearchItem } from '@/lib/knowledge/application/search'
import type { SlackSearchMessage } from '@/lib/slack-search/types'

function sourceUrl(result: KnowledgeSearchItem, organizationId: string, baseUrl: string): string {
  if (result.sourceUrl) {
    try {
      const url = new URL(result.sourceUrl)
      if (
        (url.protocol === 'https:' || url.protocol === 'http:') &&
        !url.username &&
        !url.password &&
        url.href.length <= 3000
      )
        return url.href
    } catch {
      /** An invalid provider URL uses the canonical document link. */
    }
  }
  return new URL(
    `/o/${encodeURIComponent(organizationId)}/knowledge/${encodeURIComponent(result.knowledgeBaseId)}/${encodeURIComponent(result.documentId)}`,
    baseUrl
  ).href
}

export function slackSearchReply(
  message: SlackSearchMessage,
  text: string,
  blocks?: SlackJsonObject[]
): SlackMessage {
  return {
    channel: message.channelId,
    text,
    blocks,
    thread_ts: message.threadTs,
    unfurl_links: false,
    unfurl_media: false,
  }
}

/** Presents the first five documents, preserving the ranking of their best returned chunks. */
export function renderSlackSearchResults(
  message: SlackSearchMessage,
  organizationId: string,
  results: KnowledgeSearchItem[],
  baseUrl: string
): SlackMessage {
  const seen = new Set<string>()
  const documents: KnowledgeSearchItem[] = []
  for (const result of results) {
    if (seen.has(result.documentId)) continue
    seen.add(result.documentId)
    documents.push(result)
    if (documents.length === 5) break
  }
  const blocks: SlackJsonObject[] = [
    {
      type: 'section',
      text: {
        type: 'plain_text',
        text: documents.length ? 'Search results' : 'No results found that you can access.',
      },
    },
  ]
  for (const [index, result] of documents.entries()) {
    blocks.push({
      type: 'section',
      text: {
        type: 'plain_text',
        text: `${index + 1}. ${truncate(result.documentName || 'Untitled document', 150)}\n${truncate(result.content.replace(/\s+/g, ' ').trim(), 300)}`,
      },
      accessory: {
        type: 'button',
        action_id: `sim_search.open_document.${index}`,
        text: { type: 'plain_text', text: 'Open' },
        url: sourceUrl(result, organizationId, baseUrl),
      },
    })
  }
  const searchUrl = new URL(`/o/${encodeURIComponent(organizationId)}/search`, baseUrl)
  searchUrl.searchParams.set('q', message.query)
  /** Slack caps button URLs at 3,000 characters; long queries still get a link to Search. */
  if (searchUrl.href.length > 3000) searchUrl.search = ''
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        action_id: 'sim_search.open_search',
        text: { type: 'plain_text', text: 'Open in Sim Search' },
        url: searchUrl.href,
      },
    ],
  })
  return slackSearchReply(
    message,
    documents.length
      ? `Found ${documents.length} search results. Open Slack to view them.`
      : 'No results found that you can access.',
    blocks
  )
}
