import type { SlackJsonObject, SlackMessage } from '@/lib/internal/slack/client'
import type { SlackSearchMessage } from '@/lib/slack-search/types'
import { slackSearchThreadTimestamp } from '@/lib/slack-search/types'

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

/** The destination is a verified installation, never a URL supplied by a message or model. */
export function renderSlackSearchRedirect(
  message: SlackSearchMessage,
  appId: string
): SlackMessage {
  const url = new URL('https://slack.com/app_redirect')
  url.searchParams.set('app', appId)
  url.searchParams.set('team', message.teamId)
  const text = 'This bot has moved. Continue your conversation in the Sim Search app.'
  return slackSearchReply(
    { ...message, threadTs: slackSearchThreadTimestamp(message) },
    `${text} ${url.href}`,
    [
      { type: 'section', text: { type: 'plain_text', text } },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            action_id: 'sim_search.open_replacement',
            text: { type: 'plain_text', text: 'Open Sim Search' },
            url: url.href,
          },
        ],
      },
    ]
  )
}
