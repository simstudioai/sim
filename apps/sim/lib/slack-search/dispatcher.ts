import { receiveSlackSearchMessage } from '@/lib/knowledge/application/slack-search/process-message'
import { parseSlackSearchMessage } from '@/lib/slack-search/types'

/** Routes authenticated Slack payloads to named application handlers. Unsupported interactions acknowledge immediately. */
export async function dispatchSlackSearch(input: {
  credentialId: string
  credentialVersion: string
  body: unknown
  receivedAt: number
}) {
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
