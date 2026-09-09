import { z } from 'zod'
import type { SlackSearchJob } from '@/lib/slack-search/types'

const slackTimestamp = z.string().regex(/^\d{1,12}\.\d{1,9}$/)
export const slackSearchConversationSchema = z
  .object({
    type: z.literal('slack'),
    installationId: z.string().min(1).max(200),
    channelId: z.string().regex(/^[CGD][A-Z0-9]+$/),
    origin: z
      .object({
        channelId: z.string().regex(/^[CG][A-Z0-9]+$/),
        threadTs: slackTimestamp,
        messageTs: slackTimestamp,
      })
      .optional(),
    threadTs: slackTimestamp,
    slackUserId: z.string().min(1).max(200),
    lastStopTs: slackTimestamp.nullable(),
  })
  .refine(
    (conversation) =>
      conversation.channelId.startsWith('D') ||
      (conversation.origin?.channelId === conversation.channelId &&
        conversation.threadTs === conversation.origin.messageTs),
    'Channel intake must retain its original mention identity'
  )
export type SlackSearchConversation = z.infer<typeof slackSearchConversationSchema>

/** JSON tuple encoding prevents ambiguous keys even if an identifier contains a separator. */
export function slackSearchConversationKey(
  installationId: string,
  channelId: string,
  threadTs: string
) {
  return `slack:${JSON.stringify([installationId, channelId, threadTs])}`
}

export function slackSearchConversation(job: SlackSearchJob): SlackSearchConversation {
  return {
    type: 'slack',
    installationId: job.installationId,
    channelId: job.message.channelId,
    threadTs: job.message.threadTs ?? job.message.messageTs,
    slackUserId: job.message.userId,
    lastStopTs: null,
    ...(job.message.origin ? { origin: job.message.origin } : {}),
  }
}
