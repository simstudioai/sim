import { truncate } from '@sim/utils/string'
import { z } from 'zod'
import type { listSlackSearchInstallations } from '@/lib/knowledge/application/slack-search/installations'

/** Configures an existing organization bot; OAuth and secret inputs stay in the setup wizard. */
export const slackSearchSettingsPatchSchema = z.strictObject({
  credentialId: z.string().min(1).max(200),
  enabled: z.boolean(),
})

/** Explicitly bounded metadata only; never include app secrets, credential payloads or OAuth state. */
export function projectSlackSearchSettingsForTool(
  result: Awaited<ReturnType<typeof listSlackSearchInstallations.execute>>
) {
  return {
    sharedAppAvailable: result.sharedAppAvailable,
    installations: result.installations.slice(0, 100).map((row) => ({
      id: row.id,
      credentialId: row.credentialId,
      appId: row.appId,
      appKind: row.appKind,
      teamId: row.teamId,
      teamName: truncate(row.teamName, 200, ''),
      enabled: row.enabled,
      needsValidation: row.needsValidation,
      lastEventAt: row.lastEventAt?.toISOString() ?? null,
    })),
    bots: result.bots
      .slice(0, 100)
      .map((bot) => ({ id: bot.id, displayName: truncate(bot.displayName, 500, '') })),
  }
}
