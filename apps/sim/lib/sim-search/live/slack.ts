import { dateSortDirection, nativeDateBounds, nativeText } from '@/lib/sim-search/live/dates'
import { array, NativeSearchError, object, string } from '@/lib/sim-search/live/http'
import {
  slackConversationName,
  slackConversationUrl,
  slackPlainText,
} from '@/lib/sim-search/live/slack-format'
import type {
  NativeClient,
  NativeDocument,
  NativePage,
  NativeSearchInput,
} from '@/lib/sim-search/live/types'

/** Slack's own label for an account whose name is unavailable. */
const SLACK_MEMBER = 'Slack member'
/** Directory lookups one read may make; a DM or typical thread has only a few authors. */
const MAX_AUTHOR_LOOKUPS = 10

function slackResult(value: unknown) {
  const data = object(value)
  if (data.ok !== true) {
    const code = string(data.error)
    throw new NativeSearchError(
      code === 'ratelimited' || code === 'rate_limited'
        ? 'rate_limited'
        : code === 'missing_scope' || code === 'invalid_auth' || code === 'token_revoked'
          ? 'reconnect'
          : 'unavailable',
      code === 'missing_scope'
        ? 'Reconnect Slack with RTS search scopes. The Slack app must be internal or directory-approved for RTS.'
        : `Slack search is unavailable (${code || 'invalid response'}).`
    )
  }
  return data
}

export async function searchSlack(
  client: NativeClient,
  input: NativeSearchInput
): Promise<NativePage> {
  if (!input.scopes.includes('search:read.public'))
    throw new NativeSearchError(
      'reconnect',
      'Reconnect your Slack account to grant permission to search.'
    )
  const channels = [
    ['public_channel', 'search:read.public'],
    ['private_channel', 'search:read.private'],
    ['mpim', 'search:read.mpim'],
    ['im', 'search:read.im'],
  ]
    .filter(
      ([type, scope]) =>
        input.scopes.includes(scope) &&
        (input.policy?.includeDirectMessages !== false || !['im', 'mpim'].includes(type))
    )
    .map(([type]) => type)
  const dates = nativeDateBounds(input)
  const dateModifiers = [
    dates.start
      ? `after:${new Date(Date.parse(dates.start) - 86400000).toISOString().slice(0, 10)}`
      : '',
    dates.end
      ? `before:${new Date(Date.parse(dates.end) + 86400000).toISOString().slice(0, 10)}`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
  const modifiers = [input.native?.modifiers, dateModifiers].filter(Boolean).join(' ')
  const data = slackResult(
    await client.json('/api/assistant.search.context', {
      body: {
        query: [nativeText(input) || dateModifiers, input.native?.modifiers]
          .filter(Boolean)
          .join(' '),
        channel_types: channels,
        include_archived_channels: input.policy?.includeArchived ?? true,
        content_types: input.scopes.includes('search:read.files')
          ? ['messages', 'files']
          : ['messages'],
        include_context_messages: true,
        limit: Math.min(input.limit, 20),
        ...(dates.start ? { after: Math.floor(Date.parse(dates.start) / 1000) - 1 } : {}),
        ...(dates.end ? { before: Math.ceil(Date.parse(dates.end) / 1000) } : {}),
        ...(dateSortDirection(input.filters)
          ? { sort: 'timestamp', sort_dir: dateSortDirection(input.filters) }
          : {}),
        ...(input.native?.cursor ? { cursor: input.native.cursor } : {}),
        ...(input.native?.termClauses ? { term_clauses: input.native.termClauses } : {}),
        ...(modifiers ? { modifiers } : {}),
        ...(input.native?.keywordOnly || !nativeText(input)
          ? { disable_semantic_search: true }
          : {}),
      },
    })
  )
  const messages = array(object(data.results).messages)
  const users = new Map<string, string>()
  for (const message of messages) {
    const context = object(message.context_messages)
    for (const [id, name] of [
      [string(message.author_user_id), string(message.author_name)],
      ...[...array(context.before), ...array(context.after)].map((m) => [
        string(m.user_id),
        string(m.author_name),
      ]),
    ])
      if (id && name && !users.has(id)) users.set(id, name)
  }
  const documents = messages.map((message): NativeDocument => {
    const context = object(message.context_messages)
    const before = array(context.before)
    const after = array(context.after)
    /** Surrounding messages come from several people, so each line names its author. */
    const line = (author: string, text: string) =>
      before.length || after.length ? `${author || SLACK_MEMBER}: ${text}` : text
    const contextLine = (m: Record<string, unknown>) => {
      const contextText = slackPlainText(string(m.text) || string(m.content), users)
      return (
        contextText &&
        line(string(m.author_name) || users.get(string(m.user_id)) || '', contextText)
      )
    }
    const text = slackPlainText(string(message.content), users)
    const ts = string(message.message_ts)
    const timestamp = Number(ts) * 1000
    return {
      id: ts,
      ...(string(message.thread_ts) ? { threadId: string(message.thread_ts) } : {}),
      container: string(message.channel_id),
      title: slackConversationName(string(message.channel_name), string(message.channel_id)),
      containerName: slackConversationName(
        string(message.channel_name),
        string(message.channel_id)
      ),
      containerUrl: slackConversationUrl(string(message.permalink), string(message.channel_id)),
      url: string(message.permalink),
      content: [
        ...before.map(contextLine),
        text &&
          line(
            string(message.author_name) || users.get(string(message.author_user_id)) || '',
            text
          ),
        ...after.map(contextLine),
      ]
        .filter(Boolean)
        .join('\n'),
      author: string(message.author_name),
      ...(Number.isFinite(timestamp) && timestamp > 0
        ? { modifiedAt: new Date(timestamp).toISOString() }
        : {}),
    }
  })
  for (const file of array(object(data.results).files)) {
    const updated = Number(file.date_updated ?? file.date_created) * 1000
    documents.push({
      id: string(file.file_id),
      kind: 'file',
      title: string(file.title),
      url: string(file.permalink),
      content: slackPlainText(string(file.content), users),
      author: string(file.author_name),
      ...(Number.isFinite(updated) && updated > 0
        ? { modifiedAt: new Date(updated).toISOString() }
        : {}),
    })
  }
  return {
    documents,
    nextCursor: string(object(data.response_metadata).next_cursor) || undefined,
    message: `Slack RTS searches ${channels.join(', ')} with your user token. Semantic matching depends on your Slack plan; date ordering uses keyword retrieval. Message timestamps are posting dates; edits may not be reflected in date filtering.`,
  }
}

export async function readSlack(
  client: NativeClient,
  id: string,
  channel?: string,
  kind?: string,
  threadId?: string
): Promise<NativeDocument> {
  if (kind === 'file') {
    if (!/^F[A-Z0-9]+$/.test(id))
      throw new NativeSearchError('unavailable', 'Invalid Slack file reference.')
    const data = slackResult(await client.json('/api/files.info', { query: { file: id } }))
    const file = object(data.file)
    return {
      id,
      kind,
      title: string(file.title),
      url: string(file.permalink),
      content: `File preview (open the source for full contents):\n${string(file.preview_plain_text) || string(file.preview) || string(file.title)}`,
    }
  }
  if (
    !channel ||
    !/^\d+\.\d+$/.test(id) ||
    (threadId && !/^\d+\.\d+$/.test(threadId)) ||
    !/^[A-Z0-9]+$/.test(channel)
  )
    throw new NativeSearchError('unavailable', 'Invalid Slack message reference.')
  const data = slackResult(
    await client.json('/api/conversations.replies', {
      query: {
        channel,
        ts: threadId ?? id,
        limit: '100',
        ...(threadId && threadId !== id ? { oldest: id, inclusive: 'true' } : {}),
      },
    })
  )
  if (
    array(data.messages).length === 0 ||
    (threadId && !array(data.messages).some((message) => string(message.ts) === id))
  )
    throw new NativeSearchError('unavailable', 'The message is no longer accessible.')
  const [link, authors] = await Promise.all([
    client.json('/api/chat.getPermalink', { query: { channel, message_ts: id } }).then(slackResult),
    slackAuthorNames(client, array(data.messages)),
  ])
  return {
    id,
    container: channel,
    threadId,
    title: 'Slack conversation',
    containerName: 'Slack conversation',
    containerUrl: slackConversationUrl(string(link.permalink), channel),
    url: string(link.permalink),
    modifiedAt: new Date(Number(id) * 1000).toISOString(),
    content:
      array(data.messages)
        .map(
          (m) =>
            `${authors.get(string(m.user)) || string(m.username) || SLACK_MEMBER}: ${slackPlainText(string(m.text), authors)}`
        )
        .join('\n') +
      (data.has_more ? '\n[Thread continues; open the source for the remaining messages.]' : ''),
  }
}

/**
 * Names the authors of read messages. conversations.replies identifies them only by user ID,
 * so names come from an embedded profile when present, else users.info (users:read). A name
 * that cannot be looked up keeps the generic label rather than failing the read.
 */
async function slackAuthorNames(
  client: NativeClient,
  messages: Record<string, unknown>[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  for (const message of messages) {
    const profile = object(message.user_profile)
    const name = string(profile.display_name) || string(profile.real_name)
    if (string(message.user) && name) names.set(string(message.user), name)
  }
  const unresolved = [
    ...new Set(messages.map((message) => string(message.user)).filter(Boolean)),
  ].filter((user) => !names.has(user))
  await Promise.all(
    unresolved.slice(0, MAX_AUTHOR_LOOKUPS).map(async (user) => {
      const data = object(
        await client.json('/api/users.info', { query: { user } }).catch((error: unknown) => {
          if (error instanceof NativeSearchError) return undefined
          throw error
        })
      )
      const profile = object(object(data.user).profile)
      const name =
        data.ok === true &&
        (string(profile.display_name) ||
          string(profile.real_name) ||
          string(object(data.user).real_name))
      if (name) names.set(user, name)
    })
  )
  return names
}
