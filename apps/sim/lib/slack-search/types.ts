import { z } from 'zod'

const id = z.string().min(1).max(200)
export const slackSearchMessageSchema = z.object({
  appId: id,
  teamId: id,
  eventId: id,
  userId: id,
  channelId: z.string().regex(/^D[A-Z0-9]+$/),
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
    type: z.literal('message'),
    channel_type: z.literal('im'),
    channel: id,
    user: id,
    text: z.string().max(40_000),
    thread_ts: z.string().optional(),
    subtype: z.string().optional(),
    bot_id: z.string().optional(),
    bot_profile: z.unknown().optional(),
    user_team: id.optional(),
  }),
})

/** Accepts only new human DMs; file captions may be searched but file bytes are never read. */
export function parseSlackSearchMessage(
  body: unknown,
  now = Date.now()
): SlackSearchMessage | null {
  const parsed = eventSchema.safeParse(body)
  if (!parsed.success) return null
  const { event, ...envelope } = parsed.data
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
    threadTs: event.thread_ts,
    query: query.length > 2000 ? '' : query,
    queryTooLong: query.length > 2000,
  })
}
