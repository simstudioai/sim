import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { MAX_SELECTOR_OPTIONS, MAX_SELECTOR_PAGES } from '@/lib/selectors/limits'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import {
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  requireListRequest,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type SlackSelectorKey = Extract<ServerSelectorKey, 'slack.channels' | 'slack.users'>
type SlackMethod =
  | 'conversations.info'
  | 'conversations.list'
  | 'conversations.members'
  | 'users.conversations'
  | 'users.info'
  | 'users.list'
type SlackCursorMode = 'users' | 'scoped' | 'oauth' | 'bot-all' | 'bot-public'

const SLACK_PAGE_LIMIT = 200
const SLACK_CURSOR_VERSION = '1'
const MAX_SLACK_SELECTOR_CURSOR_LENGTH = 16 * 1024
const SCOPED_USER_ID_PATTERN =
  /-usr_([UW][A-Z0-9]+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface SlackApiResponse {
  ok?: boolean
  error?: string
  channel?: SlackChannel
  channels?: SlackChannel[]
  user?: SlackUser
  members?: Array<SlackUser | string>
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

interface SlackChannelPage {
  channels: SlackChannel[]
  nextCursor?: string
}

type SlackCursorState =
  | { mode: 'users'; cursor: string }
  | { mode: 'scoped'; conversations?: string; memberships?: string }
  | { mode: 'oauth' | 'bot-all' | 'bot-public'; conversations: string }

interface SlackChannelAuthentication {
  accessToken: string
  isBotCredential: boolean
  scopedUserId: string | null
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
  params: Record<string, string>,
  acceptedErrors: readonly string[] = []
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
  if (!data.ok && !acceptedErrors.includes(data.error ?? '')) {
    throw new SelectorOptionsUnavailableError()
  }
  return data
}

function readProviderCursor(data: SlackApiResponse): string | undefined {
  const cursor = data.response_metadata?.next_cursor?.trim() || undefined
  if (cursor && cursor.length > MAX_SLACK_SELECTOR_CURSOR_LENGTH) {
    throw new SelectorOptionsUnavailableError()
  }
  return cursor
}

function readCursorParam(params: URLSearchParams, key: string): string | undefined {
  const values = params.getAll(key)
  if (values.length === 0) return undefined
  if (values.length !== 1) throw new SelectorContextUnavailableError()
  const value = values[0]?.trim()
  if (!value || value.length > MAX_SLACK_SELECTOR_CURSOR_LENGTH) {
    throw new SelectorContextUnavailableError()
  }
  return value
}

function parseSlackCursor(cursor: string | undefined): SlackCursorState | undefined {
  if (!cursor) return undefined
  if (cursor.length > MAX_SLACK_SELECTOR_CURSOR_LENGTH) {
    throw new SelectorContextUnavailableError()
  }

  const params = new URLSearchParams(cursor)
  const allowedKeys = new Set(['v', 'mode', 'cursor', 'conversations', 'memberships'])
  if ([...params.keys()].some((key) => !allowedKeys.has(key))) {
    throw new SelectorContextUnavailableError()
  }
  const version = readCursorParam(params, 'v')
  const mode = readCursorParam(params, 'mode') as SlackCursorMode | undefined
  if (version !== SLACK_CURSOR_VERSION) throw new SelectorContextUnavailableError()

  if (mode === 'users') {
    if (params.has('conversations') || params.has('memberships')) {
      throw new SelectorContextUnavailableError()
    }
    const userCursor = readCursorParam(params, 'cursor')
    if (!userCursor) throw new SelectorContextUnavailableError()
    return { mode, cursor: userCursor }
  }

  if (params.has('cursor')) throw new SelectorContextUnavailableError()
  const conversations = readCursorParam(params, 'conversations')
  const memberships = readCursorParam(params, 'memberships')
  if (mode === 'scoped') {
    if (!conversations && !memberships) throw new SelectorContextUnavailableError()
    return {
      mode,
      ...(conversations ? { conversations } : {}),
      ...(memberships ? { memberships } : {}),
    }
  }
  if (mode !== 'oauth' && mode !== 'bot-all' && mode !== 'bot-public') {
    throw new SelectorContextUnavailableError()
  }
  if (!conversations || memberships) throw new SelectorContextUnavailableError()
  return { mode, conversations }
}

function encodeSlackCursor(state: SlackCursorState): string {
  const params = new URLSearchParams({ v: SLACK_CURSOR_VERSION, mode: state.mode })
  if (state.mode === 'users') {
    params.set('cursor', state.cursor)
  } else {
    if (state.conversations) params.set('conversations', state.conversations)
    if (state.mode === 'scoped' && state.memberships) {
      params.set('memberships', state.memberships)
    }
  }
  const cursor = params.toString()
  if (cursor.length > MAX_SLACK_SELECTOR_CURSOR_LENGTH) {
    throw new SelectorOptionsUnavailableError()
  }
  return cursor
}

function channelOption(channel: SlackChannel): { id: string; label: string } | null {
  if (!channel.id || !channel.name || channel.is_archived) return null
  const validation = validateAlphanumericId(channel.id, 'channelId', 50)
  if (!validation.isValid || !/^[CDG][A-Z0-9]+$/i.test(channel.id)) return null
  return { id: channel.id, label: `#${channel.name}` }
}

function userOption(user: SlackUser): { id: string; label: string } | null {
  if (!user.id || !user.name || user.deleted || user.is_bot) return null
  const validation = validateAlphanumericId(user.id, 'userId', 50)
  if (!validation.isValid || !/^[UW][A-Z0-9]+$/i.test(user.id)) return null
  return { id: user.id, label: user.real_name || user.name }
}

function uniqueOptions(
  items: Array<{ id: string; label: string }>
): Array<{ id: string; label: string }> {
  return [...new Map(items.map((item) => [item.id, item])).values()]
}

async function fetchChannelPage(
  args: ExecuteServerSelectorArgs,
  method: 'conversations.list' | 'users.conversations',
  accessToken: string,
  params: Record<string, string>,
  cursor?: string
): Promise<SlackChannelPage> {
  const data = await fetchSlackApi(args, method, accessToken, {
    ...params,
    limit: String(SLACK_PAGE_LIMIT),
    ...(cursor ? { cursor } : {}),
  })
  return {
    channels: Array.isArray(data.channels) ? data.channels : [],
    nextCursor: readProviderCursor(data),
  }
}

async function resolveChannelAuthentication(
  args: ExecuteServerSelectorArgs
): Promise<SlackChannelAuthentication> {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  const accessToken = await resolveSelectorOAuthAccessToken({
    credential: args.credential,
    serviceId: 'slack',
    protectedValues: args.protectedValues,
  })
  const isBotCredential =
    Boolean(args.credential.fixedToken) || args.credential.access?.credentialType !== 'oauth'
  return {
    accessToken,
    isBotCredential,
    scopedUserId: await readScopedSlackUserId(args),
  }
}

function assertChannelCursorMode(
  cursor: SlackCursorState | undefined,
  authentication: SlackChannelAuthentication
): void {
  if (!cursor) return
  if (cursor.mode === 'users') throw new SelectorContextUnavailableError()
  if (authentication.scopedUserId) {
    if (cursor.mode !== 'scoped') throw new SelectorContextUnavailableError()
    return
  }
  if (authentication.isBotCredential) {
    if (cursor.mode !== 'bot-all' && cursor.mode !== 'bot-public') {
      throw new SelectorContextUnavailableError()
    }
    return
  }
  if (cursor.mode !== 'oauth') throw new SelectorContextUnavailableError()
}

async function listScopedSlackChannels(
  args: ExecuteServerSelectorArgs,
  authentication: SlackChannelAuthentication,
  cursor: Extract<SlackCursorState, { mode: 'scoped' }> | undefined
) {
  const publicPage =
    !cursor || cursor.conversations
      ? await fetchChannelPage(
          args,
          'conversations.list',
          authentication.accessToken,
          {
            types: 'public_channel,private_channel',
            exclude_archived: 'true',
          },
          cursor?.conversations
        )
      : undefined

  let privatePage: SlackChannelPage | undefined
  if (!cursor || cursor.memberships) {
    try {
      privatePage = await fetchChannelPage(
        args,
        'users.conversations',
        authentication.accessToken,
        {
          user: authentication.scopedUserId!,
          types: 'private_channel',
          exclude_archived: 'true',
        },
        cursor?.memberships
      )
    } catch (error) {
      if (args.signal?.aborted) throw error
      privatePage = undefined
    }
  }

  const items = uniqueOptions([
    ...(publicPage?.channels ?? []).flatMap((channel) => {
      if (channel.is_private !== false) return []
      const option = channelOption(channel)
      return option ? [option] : []
    }),
    ...(privatePage?.channels ?? []).flatMap((channel) => {
      const option = channelOption(channel)
      return option ? [option] : []
    }),
  ])
  const conversations = publicPage?.nextCursor
  const memberships = privatePage?.nextCursor
  return listSelectorResult(
    items,
    conversations || memberships
      ? encodeSlackCursor({
          mode: 'scoped',
          ...(conversations ? { conversations } : {}),
          ...(memberships ? { memberships } : {}),
        })
      : undefined
  )
}

async function listUnscopedSlackChannels(
  args: ExecuteServerSelectorArgs,
  authentication: SlackChannelAuthentication,
  cursor: Extract<SlackCursorState, { mode: 'oauth' | 'bot-all' | 'bot-public' }> | undefined
) {
  let mode: 'oauth' | 'bot-all' | 'bot-public' = authentication.isBotCredential
    ? cursor?.mode === 'bot-public'
      ? 'bot-public'
      : 'bot-all'
    : 'oauth'
  let page: SlackChannelPage
  try {
    page = await fetchChannelPage(
      args,
      'conversations.list',
      authentication.accessToken,
      {
        types: mode === 'bot-public' ? 'public_channel' : 'public_channel,private_channel',
        exclude_archived: 'true',
      },
      cursor?.conversations
    )
  } catch (error) {
    if (args.signal?.aborted) throw error
    if (!authentication.isBotCredential || mode === 'bot-public') throw error
    mode = 'bot-public'
    page = await fetchChannelPage(args, 'conversations.list', authentication.accessToken, {
      types: 'public_channel',
      exclude_archived: 'true',
    })
  }

  const items = page.channels.flatMap((channel) => {
    if (channel.is_private && !channel.is_member) return []
    const option = channelOption(channel)
    return option ? [option] : []
  })
  return listSelectorResult(
    items,
    page.nextCursor ? encodeSlackCursor({ mode, conversations: page.nextCursor }) : undefined
  )
}

async function installingUserIsChannelMember(
  args: ExecuteServerSelectorArgs,
  accessToken: string,
  channelId: string,
  scopedUserId: string
): Promise<boolean> {
  let cursor: string | undefined
  let examinedMembers = 0
  const seenCursors = new Set<string>()
  for (let page = 0; page < MAX_SELECTOR_PAGES; page++) {
    const data = await fetchSlackApi(args, 'conversations.members', accessToken, {
      channel: channelId,
      limit: String(SLACK_PAGE_LIMIT),
      ...(cursor ? { cursor } : {}),
    })
    const remaining = MAX_SELECTOR_OPTIONS - examinedMembers
    const members = Array.isArray(data.members) ? data.members.slice(0, remaining) : []
    if (members.some((member) => member === scopedUserId)) return true
    examinedMembers += members.length
    if (examinedMembers >= MAX_SELECTOR_OPTIONS) return false

    cursor = readProviderCursor(data)
    if (!cursor || seenCursors.has(cursor)) return false
    seenCursors.add(cursor)
  }
  return false
}

async function hydrateSlackChannel(
  args: ExecuteServerSelectorArgs,
  authentication: SlackChannelAuthentication,
  rawChannelId: string
) {
  const channelId = rawChannelId.trim()
  const validation = validateAlphanumericId(channelId, 'channelId', 50)
  if (!validation.isValid || !/^[CDG][A-Z0-9]+$/i.test(channelId)) {
    return detailSelectorResult(null)
  }
  const data = await fetchSlackApi(
    args,
    'conversations.info',
    authentication.accessToken,
    { channel: channelId },
    ['channel_not_found']
  )
  if (!data.ok || data.channel?.id !== channelId || typeof data.channel.is_private !== 'boolean') {
    return detailSelectorResult(null)
  }
  const option = channelOption(data.channel)
  if (!option) return detailSelectorResult(null)
  if (data.channel.is_private) {
    if (authentication.scopedUserId) {
      try {
        if (
          !(await installingUserIsChannelMember(
            args,
            authentication.accessToken,
            channelId,
            authentication.scopedUserId
          ))
        ) {
          return detailSelectorResult(null)
        }
      } catch (error) {
        if (args.signal?.aborted) throw error
        return detailSelectorResult(null)
      }
    } else if (!data.channel.is_member) {
      return detailSelectorResult(null)
    }
  }
  return detailSelectorResult(option)
}

async function executeSlackChannels(args: ExecuteServerSelectorArgs) {
  const cursor = args.request.kind === 'list' ? parseSlackCursor(args.request.cursor) : undefined
  const authentication = await resolveChannelAuthentication(args)
  if (args.request.kind === 'detail') {
    return hydrateSlackChannel(args, authentication, args.request.id)
  }
  requireListRequest(args.selectorKey, args.request)
  assertChannelCursorMode(cursor, authentication)
  if (authentication.scopedUserId) {
    return listScopedSlackChannels(
      args,
      authentication,
      cursor as Extract<SlackCursorState, { mode: 'scoped' }> | undefined
    )
  }
  return listUnscopedSlackChannels(
    args,
    authentication,
    cursor as Extract<SlackCursorState, { mode: 'oauth' | 'bot-all' | 'bot-public' }> | undefined
  )
}

async function executeSlackUsers(args: ExecuteServerSelectorArgs) {
  const request =
    args.request.kind === 'list' ? requireListRequest(args.selectorKey, args.request) : null
  const cursor = request ? parseSlackCursor(request.cursor) : undefined
  if (cursor && cursor.mode !== 'users') throw new SelectorContextUnavailableError()
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  const accessToken = await resolveSelectorOAuthAccessToken({
    credential: args.credential,
    serviceId: 'slack',
    protectedValues: args.protectedValues,
  })
  if (args.request.kind === 'detail') {
    const userId = args.request.id.trim()
    const validation = validateAlphanumericId(userId, 'userId', 50)
    if (!validation.isValid || !/^[UW][A-Z0-9]+$/i.test(userId)) {
      return detailSelectorResult(null)
    }
    const data = await fetchSlackApi(args, 'users.info', accessToken, { user: userId }, [
      'user_not_found',
    ])
    if (!data.ok || data.user?.id !== userId) return detailSelectorResult(null)
    return detailSelectorResult(userOption(data.user))
  }

  const data = await fetchSlackApi(args, 'users.list', accessToken, {
    limit: String(SLACK_PAGE_LIMIT),
    ...(cursor?.mode === 'users' ? { cursor: cursor.cursor } : {}),
  })
  const users = (data.members ?? []).filter(
    (member): member is SlackUser => typeof member === 'object' && member !== null
  )
  const nextCursor = readProviderCursor(data)
  return listSelectorResult(
    users.flatMap((user) => {
      const option = userOption(user)
      return option ? [option] : []
    }),
    nextCursor ? encodeSlackCursor({ mode: 'users', cursor: nextCursor }) : undefined
  )
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
    execute: executeSlackChannels,
  },
  'slack.users': {
    credential,
    destination: 'fixed',
    execute: executeSlackUsers,
  },
} satisfies ServerSelectorAttachmentMap<SlackSelectorKey>
