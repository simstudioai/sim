import { z } from 'zod'

const id = z.string().min(1).max(200)
export const slackSearchMessageSchema = z.object({
  appId: id,
  teamId: id,
  eventId: id,
  userId: id,
  channelId: z.string().regex(/^[CGD][A-Z0-9]+$/),
  origin: z
    .object({
      channelId: z.string().regex(/^[CG][A-Z0-9]+$/),
      threadTs: z.string().regex(/^\d+\.\d+$/),
      messageTs: z.string().regex(/^\d+\.\d+$/),
    })
    .optional(),
  messageTs: z.string().regex(/^\d+\.\d+$/),
  threadTs: z
    .string()
    .regex(/^\d+\.\d+$/)
    .optional(),
  query: z.string().trim().max(2000),
  queryTooLong: z.boolean(),
})
export type SlackSearchMessage = z.infer<typeof slackSearchMessageSchema>

/** Queue-only contract; no secrets, results, or caller-supplied Sim user identity. */
export const slackSearchJobSchema = z.object({
  installationId: id,
  revision: id,
  credentialId: id,
  credentialVersion: id,
  receivedAt: z.number().int().positive(),
  message: slackSearchMessageSchema,
})
export type SlackSearchJob = z.infer<typeof slackSearchJobSchema>

const eventSchema = z.object({
  type: z.literal('event_callback'),
  api_app_id: id,
  team_id: id,
  event_id: id,
  event_time: z.number().int(),
  event: z.object({
    type: z.enum(['message', 'app_mention']),
    channel_type: z.string().optional(),
    channel: id,
    user: id,
    text: z.string().max(40_000),
    ts: z.string().regex(/^\d+\.\d+$/),
    thread_ts: z.string().optional(),
    subtype: z.string().optional(),
    bot_id: z.string().optional(),
    bot_profile: z.unknown().optional(),
    user_team: id.optional(),
  }),
})

/** Accepts human bot DMs and explicit channel mentions; ordinary channel messages are never ingested. */
export function parseSlackSearchMessage(
  body: unknown,
  now = Date.now()
): SlackSearchMessage | null {
  const parsed = eventSchema.safeParse(body)
  if (!parsed.success) return null
  const { event, ...envelope } = parsed.data
  const mention = event.type === 'app_mention'
  if (
    mention
      ? !/^[CG][A-Z0-9]+$/.test(event.channel)
      : event.channel_type !== 'im' || !/^D[A-Z0-9]+$/.test(event.channel)
  )
    return null
  if (event.bot_id || event.bot_profile || (event.subtype && event.subtype !== 'file_share'))
    return null
  if (event.user_team && event.user_team !== envelope.team_id) return null
  if (
    envelope.event_time * 1000 < now - 23 * 60 * 60 * 1000 ||
    envelope.event_time * 1000 > now + 60_000
  )
    return null
  const query = event.text.trim()
  if (!query) return null
  return slackSearchMessageSchema.parse({
    appId: envelope.api_app_id,
    teamId: envelope.team_id,
    eventId: envelope.event_id,
    userId: event.user,
    channelId: event.channel,
    messageTs: event.ts,
    threadTs: mention ? undefined : event.thread_ts,
    ...(mention
      ? {
          origin: {
            channelId: event.channel,
            threadTs: event.thread_ts ?? event.ts,
            messageTs: event.ts,
          },
        }
      : {}),
    query: query.length > 2000 ? '' : query,
    queryTooLong: query.length > 2000,
  })
}
