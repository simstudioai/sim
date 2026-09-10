import { sha256Hex } from '@sim/security/hash'
import { z } from 'zod'

const id = z.string().min(1).max(200)
export const slackSearchCommandSchema = z.object({
  api_app_id: id,
  team_id: id,
  user_id: id,
  channel_id: z.string().regex(/^[CGD][A-Z0-9]+$/),
  command: z.enum(['/sim-search', '/sim-connect']),
  text: z.string().max(40_000),
  trigger_id: z.string().min(1).max(200),
})
export type SlackSearchCommand = z.infer<typeof slackSearchCommandSchema>

/** A verified invocation ID, independent of delivery retries and unrelated to message timestamps. */
export function slackSearchCommandEventId(command: SlackSearchCommand) {
  return `command:${sha256Hex(JSON.stringify([command.api_app_id, command.team_id, command.user_id, command.trigger_id]))}`
}
