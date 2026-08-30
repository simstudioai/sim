import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type SlackSelectorKey = Extract<ServerSelectorKey, 'slack.channels' | 'slack.users'>
type SlackMethod = 'conversations.list' | 'users.conversations' | 'users.list'

const SLACK_PAGE_LIMIT = 200
const SLACK_MAX_PAGES = 10
const SCOPED_USER_ID_PATTERN =
  /-usr_([UW][A-Z0-9]+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface SlackApiResponse {
  ok?: boolean
  error?: string
  channels?: SlackChannel[]
  members?: SlackUser[]
  response_metadata?: { next_cursor?: string }
}

interface SlackChannel {
  id?: string
  name?: string
  is_private?: boolean
  is_archived?: boolean
  is_member?: boolean
}

interface SlackUser {
  id?: string
  name?: string
  real_name?: string
  deleted?: boolean
  is_bot?: boolean
}

interface SlackChannelsResult {
  channels: SlackChannel[]
  truncated: boolean
}

function parseScopedSlackUserId(accountId: string): string | null {
  return SCOPED_USER_ID_PATTERN.exec(accountId)?.[1] ?? null
}

async function readScopedSlackUserId(args: ExecuteServerSelectorArgs): Promise<string | null> {
  const access = args.credential?.access
  if (access?.credentialType !== 'oauth' || !access.resolvedCredentialId) return null
  const [row] = await db
    .select({ accountId: account.accountId })
    .from(account)
    .where(eq(account.id, access.resolvedCredentialId))
    .limit(1)
  return row ? parseScopedSlackUserId(row.accountId) : null
}

async function fetchSlackApi(
  args: ExecuteServerSelectorArgs,
  method: SlackMethod,
  accessToken: string,
  params: Record<string, string>
): Promise<SlackApiResponse> {
  const url = new URL(`https://slack.com/api/${method}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  let data: SlackApiResponse
  try {
    data = await fetchProviderJson<SlackApiResponse>(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: args.signal,
      redirect: 'error',
    })
  } catch (error) {
    if (args.signal?.aborted) throw error
    if (
      error instanceof SelectorConnectionUnavailableError ||
      error instanceof SelectorOptionsUnavailableError
    ) {
      throw error
    }
    throw new SelectorOptionsUnavailableError()
  }
  if (!data.ok) throw new SelectorOptionsUnavailableError()
  return data
}

async function fetchAllConversations(
  args: ExecuteServerSelectorArgs,
  method: 'conversations.list' | 'users.conversations',
  accessToken: string,
  params: Record<string, string>
): Promise<SlackChannelsResult> {
  const channels: SlackChannel[] = []
  let cursor: string | undefined
  let truncated = false
  for (let page = 0; page < SLACK_MAX_PAGES; page++) {
    const data = await fetchSlackApi(args, method, accessToken, {
      ...params,
      limit: String(SLACK_PAGE_LIMIT),
      ...(cursor ? { cursor } : {}),
    })
    if (Array.isArray(data.channels)) channels.push(...data.channels)
    cursor = data.response_metadata?.next_cursor?.trim() || undefined
    if (!cursor) break
    if (page === SLACK_MAX_PAGES - 1) truncated = true
  }
  return { channels, truncated }
}

async function fetchChannels(
  args: ExecuteServerSelectorArgs,
  accessToken: string,
  includePrivate: boolean
): Promise<SlackChannelsResult> {
  return fetchAllConversations(args, 'conversations.list', accessToken, {
    types: includePrivate ? 'public_channel,private_channel' : 'public_channel',
    exclude_archived: 'true',
  })
}

async function listSlackChannels(args: ExecuteServerSelectorArgs) {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  const accessToken = await resolveSelectorOAuthAccessToken({
    credential: args.credential,
    serviceId: 'slack',
    protectedValues: args.protectedValues,
  })
  const isBotCredential =
    Boolean(args.credential.fixedToken) || args.credential.access?.credentialType !== 'oauth'
  const scopedUserId = await readScopedSlackUserId(args)

  let channelResult: SlackChannelsResult
  try {
    channelResult = await fetchChannels(args, accessToken, true)
  } catch (error) {
    if (args.signal?.aborted) throw error
    if (!isBotCredential) throw error
    channelResult = await fetchChannels(args, accessToken, false)
  }

  let allowedPrivateChannelIds: Set<string> | null = null
  let truncated = channelResult.truncated
  if (scopedUserId) {
    try {
      const scopedResult = await fetchAllConversations(args, 'users.conversations', accessToken, {
        user: scopedUserId,
        types: 'private_channel',
        exclude_archived: 'true',
      })
      allowedPrivateChannelIds = new Set(
        scopedResult.channels.flatMap((channel) => (channel.id ? [channel.id] : []))
      )
      truncated ||= scopedResult.truncated
    } catch (error) {
      if (args.signal?.aborted) throw error
      // If user membership cannot be verified, fail closed for private channels.
      allowedPrivateChannelIds = new Set()
    }
  }

  return {
    items: channelResult.channels.flatMap((channel) => {
      if (!channel.id || !channel.name || channel.is_archived) return []
      if (
        channel.is_private &&
        (allowedPrivateChannelIds ? !allowedPrivateChannelIds.has(channel.id) : !channel.is_member)
      ) {
        return []
      }
      const validation = validateAlphanumericId(channel.id, 'channelId', 50)
      if (!validation.isValid || !/^[CDG][A-Z0-9]+$/i.test(channel.id)) return []
      return [{ id: channel.id, label: `#${channel.name}` }]
    }),
    truncated,
  }
}

async function listSlackUsers(args: ExecuteServerSelectorArgs) {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  const accessToken = await resolveSelectorOAuthAccessToken({
    credential: args.credential,
    serviceId: 'slack',
    protectedValues: args.protectedValues,
  })
  const members: SlackUser[] = []
  let cursor: string | undefined
  let truncated = false
  for (let page = 0; page < SLACK_MAX_PAGES; page++) {
    const data = await fetchSlackApi(args, 'users.list', accessToken, {
      limit: String(SLACK_PAGE_LIMIT),
      ...(cursor ? { cursor } : {}),
    })
    if (Array.isArray(data.members)) members.push(...data.members)
    cursor = data.response_metadata?.next_cursor?.trim() || undefined
    if (!cursor) break
    if (page === SLACK_MAX_PAGES - 1) truncated = true
  }
  return {
    items: members.flatMap((user) => {
      if (!user.id || !user.name || user.deleted || user.is_bot) return []
      return [{ id: user.id, label: user.real_name || user.name }]
    }),
    truncated,
  }
}

const credential = {
  kind: 'stored-or-fixed-token',
  field: 'oauthCredential',
  serviceIds: ['slack'],
  tokenPrefixes: ['xoxb-'],
} as const

export const slackSelectorAttachments = {
  'slack.channels': {
    credential,
    destination: 'fixed',
    execute: async (args) => {
      const result = await listSlackChannels(args)
      return flatSelectorResult(
        args.request,
        result.items,
        false,
        result.truncated
          ? { truncated: { reason: 'provider-cap', pages: SLACK_MAX_PAGES } }
          : undefined
      )
    },
  },
  'slack.users': {
    credential,
    destination: 'fixed',
    execute: async (args) => {
      const result = await listSlackUsers(args)
      return flatSelectorResult(
        args.request,
        result.items,
        false,
        result.truncated
          ? { truncated: { reason: 'provider-cap', pages: SLACK_MAX_PAGES } }
          : undefined
      )
    },
  },
} satisfies ServerSelectorAttachmentMap<SlackSelectorKey>
