import { filterUndefined } from '@sim/utils/object'
import { z } from 'zod'
import { requestSlackApi } from '@/lib/internal/slack/client'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import {
  DEFAULT_CONVERSATION_PAGE_LIMIT,
  MAX_CONVERSATION_PAGE_LIMIT,
  MAX_CONVERSATION_PAGES,
  MAX_CONVERSATIONS,
} from '@/tools/slack/list_channels'
import type { SlackListChannelsParams, SlackListChannelsResponse } from '@/tools/slack/types'
import {
  assertSlackApiSuccess,
  requireSlackString,
  resolveSlackAccessToken,
} from '@/tools/slack/utils'

type SlackConversation = SlackListChannelsResponse['output']['channels'][number]

const optionalString = z.string().optional()
const optionalBoolean = z.boolean().optional()
const optionalNumber = z.number().finite().optional()
const conversationText = z.object({ value: optionalString }).optional()

const slackConversationSchema = z.object({
  id: z.string().trim().min(1, 'Slack conversation ID is required'),
  name: optionalString,
  is_channel: optionalBoolean,
  is_group: optionalBoolean,
  is_im: optionalBoolean,
  is_mpim: optionalBoolean,
  user: optionalString,
  is_user_deleted: optionalBoolean,
  is_open: optionalBoolean,
  is_private: optionalBoolean,
  is_archived: optionalBoolean,
  is_general: optionalBoolean,
  is_member: optionalBoolean,
  is_shared: optionalBoolean,
  is_ext_shared: optionalBoolean,
  is_org_shared: optionalBoolean,
  num_members: optionalNumber,
  topic: conversationText,
  purpose: conversationText,
  created: optionalNumber,
  creator: optionalString,
  updated: optionalNumber,
  priority: optionalNumber,
})

const slackListConversationsResponseSchema = z.object({
  ok: z.boolean(),
  error: optionalString,
  channels: z.array(slackConversationSchema).optional(),
  response_metadata: z.object({ next_cursor: optionalString }).optional(),
})

function mapSlackConversation(
  conversation: z.output<typeof slackConversationSchema>
): SlackConversation {
  const { id, topic, purpose, ...fields } = conversation
  return {
    id,
    ...filterUndefined({
      ...fields,
      topic: topic?.value,
      purpose: purpose?.value,
    }),
  }
}

function resolveBooleanParam(value: unknown, label: string, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false`)
  return value
}

function resolveBoundedInteger(
  value: unknown,
  defaultValue: number,
  label: string,
  maximum: number
): number {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    return defaultValue
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}`)
  }
  return parsed
}

function conversationTypes(params: SlackListChannelsParams): string {
  const types = ['public_channel']
  if (resolveBooleanParam(params.includePrivate, 'Include private channels', true)) {
    types.push('private_channel')
  }
  return types.join(',')
}

export const executeSlackListConversationsOperation: InternalToolOperationImplementation<
  SlackListChannelsParams
> = async (params, signal) => {
  const accessToken = resolveSlackAccessToken(params)
  const types = conversationTypes(params)
  const excludeArchived = resolveBooleanParam(
    params.excludeArchived,
    'Exclude archived channels',
    true
  )
  const limit = resolveBoundedInteger(
    params.limit,
    DEFAULT_CONVERSATION_PAGE_LIMIT,
    'Conversation page size',
    MAX_CONVERSATION_PAGE_LIMIT
  )
  const maxPages = resolveBoundedInteger(
    params.maxPages,
    MAX_CONVERSATION_PAGES,
    'Maximum conversation pages',
    MAX_CONVERSATION_PAGES
  )
  let cursor =
    params.cursor === undefined ? undefined : requireSlackString(params.cursor, 'Pagination cursor')
  const seenCursors = new Set(cursor ? [cursor] : [])
  const channels: SlackConversation[] = []
  let nextCursor: string | null = null
  let pages = 0

  while (pages < maxPages && channels.length < MAX_CONVERSATIONS) {
    const pageLimit = Math.min(limit, MAX_CONVERSATIONS - channels.length)
    const { data } = await requestSlackApi({
      accessToken,
      method: 'conversations.list',
      httpMethod: 'GET',
      query: {
        types,
        exclude_archived: String(excludeArchived),
        limit: pageLimit,
        cursor,
      },
      signal,
    })
    const parsed = slackListConversationsResponseSchema.parse(data)
    assertSlackApiSuccess(parsed, 'Failed to list conversations from Slack')
    if (!parsed.channels) {
      throw new Error('Slack returned a malformed conversations list')
    }
    if (parsed.channels.length > pageLimit) {
      throw new Error(`Slack returned more than the requested ${pageLimit} conversations`)
    }

    channels.push(...parsed.channels.map(mapSlackConversation))
    pages += 1
    nextCursor = parsed.response_metadata?.next_cursor?.trim() || null
    if (!nextCursor) break
    if (seenCursors.has(nextCursor)) {
      throw new Error('Slack returned a repeated conversation pagination cursor')
    }
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }

  return {
    success: true,
    output: {
      channels,
      ids: channels.map((conversation) => conversation.id),
      names: channels.flatMap((conversation) =>
        conversation.name === undefined ? [] : [conversation.name]
      ),
      count: channels.length,
      hasMore: Boolean(nextCursor),
      nextCursor,
      pages,
    },
  }
}
