import { receiveSlackSearchMessage } from '@/lib/knowledge/application/slack-search/process-message'
import {
  slackSearchStopSchema,
  stopSlackSearchThread,
} from '@/lib/knowledge/application/slack-search/stop'
import { parseSlackSearchMessage } from '@/lib/slack-search/types'

/** Routes authenticated Slack payloads to named application handlers. Unsupported interactions acknowledge immediately. */
export async function dispatchSlackSearch(input: {
  credentialId: string
  credentialVersion: string
  body: unknown
  receivedAt: number
}) {
  const stopped = slackSearchStopSchema.safeParse(input.body)
  if (stopped.success) {
    await stopSlackSearchThread.execute({
      principal: {
        kind: 'slack_installation',
        credentialId: input.credentialId,
        credentialVersion: input.credentialVersion,
        appId: stopped.data.api_app_id,
        teamId: stopped.data.team_id,
        eventId: stopped.data.event_id,
        receivedAt: new Date(input.receivedAt),
      },
      input: stopped.data,
    })
    return
  }
  const message = parseSlackSearchMessage(input.body)
  if (!message) return
  await receiveSlackSearchMessage.execute({
    principal: {
      kind: 'slack_installation',
      credentialId: input.credentialId,
      credentialVersion: input.credentialVersion,
      appId: message.appId,
      teamId: message.teamId,
      eventId: message.eventId,
      receivedAt: new Date(input.receivedAt),
    },
    input: message,
  })
}
