/**
 * One Slack message a federated search returned, normalized for Sim Search.
 *
 * Slack is searched at query time under the asking person's own token rather
 * than crawled into a knowledge base, so a result carries everything needed to
 * show and cite it without anything having been stored.
 */
export interface SlackSearchResult {
  /** Stable identity of the message: its channel and timestamp. */
  channelId: string
  messageTs: string
  channelName: string
  authorName: string
  /** The matched message, followed by the surrounding messages when they were requested. */
  text: string
  /** Slack's own permalink to the message. */
  permalink: string
  /** When the message was sent. Null when Slack returned a timestamp that will not parse. */
  sentAt: Date | null
  isAuthorBot: boolean
}

/** The conversation kinds a federated Slack search covers. */
export const SLACK_SEARCH_CHANNEL_TYPES = [
  'public_channel',
  'private_channel',
  'mpim',
  'im',
] as const

export type SlackSearchChannelType = (typeof SLACK_SEARCH_CHANNEL_TYPES)[number]
