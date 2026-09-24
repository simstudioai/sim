import { z } from 'zod'

const slackResponseSchema = z
  .object({
    ok: z.boolean(),
    error: z.string().optional(),
    needed: z.string().optional(),
    detail: z.string().optional(),
  })
  .passthrough()

/** Preserve Slack's error code and actionable scope or payload details. */
export async function readSlackResponse(response: Response): Promise<Record<string, unknown>> {
  const data = slackResponseSchema.parse(await response.json())
  if (!response.ok || !data.ok) {
    const details = [data.error ?? `HTTP ${response.status}`, data.detail]
    if (data.error === 'missing_scope') {
      details.push(
        `Update the Slack app scopes${data.needed ? ` (${data.needed})` : ''}, reinstall the app, and reconnect the credential in Sim.`
      )
    }
    if (
      data.error === 'list_not_found' ||
      data.error === 'canvas_not_found' ||
      data.error === 'not_visible'
    ) {
      details.push('Check the resource ID and grant the selected Slack user or bot access.')
    }
    throw new Error(`Slack API: ${details.filter(Boolean).join(' ')}`)
  }
  return data
}
