import { z } from 'zod'
import { organizationRoutes } from '@/lib/navigation/paths'

/** A requested personal Search connection; authority always comes from the current session. */
export const searchConnectionTargetSchema = z
  .object({
    type: z.literal('link'),
    provider: z.string().trim().min(1).max(100),
    connectorType: z.string().trim().min(1).max(100),
    connectorId: z.string().min(1).max(200).optional(),
    credentialId: z.string().min(1).max(128).optional(),
  })
  .strict()
  .refine((target) => !target.credentialId || Boolean(target.connectorId), {
    message: 'A reconnect requires a configured source',
  })

export type SearchConnectionTarget = z.infer<typeof searchConnectionTargetSchema>

/** Parses a single bounded Search card body; browser and Slack accept the same targets. */
export function parseSearchConnectionBody(body: string): SearchConnectionTarget[] | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  const parsed = z
    .array(searchConnectionTargetSchema)
    .min(1)
    .max(10)
    .safeParse(Array.isArray(value) ? value : [value])
  return parsed.success ? parsed.data : null
}

/** Parses complete connection cards while withholding partial or malformed model output. */
export function parseSearchConnectionTargets(text: string): SearchConnectionTarget[] {
  const targets: SearchConnectionTarget[] = []
  for (const match of text.matchAll(/<credential>([\s\S]*?)<\/credential>/g)) {
    for (const target of parseSearchConnectionBody(match[1]) ?? []) {
      if (!targets.some((existing) => JSON.stringify(existing) === JSON.stringify(target)))
        targets.push(target)
    }
    if (targets.length > 10) throw new Error('Too many requested Search connections')
  }
  return targets
}

/** Carries an untrusted selection to the existing authenticated Integrations page, without OAuth state. */
export function searchConnectionPath(organizationId: string, target: SearchConnectionTarget) {
  return `${organizationRoutes(organizationId).integrations}?${new URLSearchParams({ connectorType: target.connectorType, ...(target.connectorId ? { connectorId: target.connectorId } : {}), ...(target.credentialId ? { credentialId: target.credentialId } : {}) })}`
}
