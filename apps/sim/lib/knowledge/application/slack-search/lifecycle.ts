import { db } from '@sim/db'
import { credential, slackSearchInstallation, slackSearchTurn } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { loadSlackAppConfiguration } from '@/lib/slack-search/app-configuration'

const id = z.string().min(1).max(200)
export const slackSearchLifecycleSchema = z.object({
  type: z.literal('event_callback'),
  api_app_id: id,
  team_id: id,
  event_id: id,
  event_time: z.number().int().positive(),
  event: z.discriminatedUnion('type', [
    z.object({ type: z.literal('app_uninstalled') }),
    z.object({
      type: z.literal('tokens_revoked'),
      tokens: z.object({
        oauth: z.array(id).max(10000).optional(),
        bot: z.array(id).max(10000).optional(),
      }),
    }),
  ]),
})
const operation = Object.freeze({
  id: 'knowledge.slack.revoke',
  capability: 'none',
  principalKinds: ['slack_app'] as const,
})

/** Revocations bypass the rollout gate and enabled check so disabling access never blocks cleanup. */
export const revokeSlackSearchAccess: OperationUseCase<
  typeof operation,
  z.infer<typeof slackSearchLifecycleSchema>,
  void
> = {
  operation,
  async execute({ principal, input }) {
    if (
      principal.kind !== 'slack_app' ||
      principal.appId !== input.api_app_id ||
      !Number.isFinite(principal.receivedAt.getTime()) ||
      Date.now() - principal.receivedAt.getTime() > 60_000 ||
      principal.receivedAt.getTime() > Date.now()
    )
      throw new OrchestrationError('forbidden', 'Verified Slack lifecycle authority is required')
    const app = await loadSlackAppConfiguration(principal.appId)
    if (!app || app.app.revision !== principal.appRevision)
      throw new OrchestrationError('forbidden', 'Slack app configuration changed')
    const occurredAt = new Date(input.event_time * 1000)
    if (occurredAt.getTime() > Date.now() + 60_000) throw new Error('Invalid Slack revocation time')
    await db.transaction(async (tx) => {
      const [installation] = await tx
        .select()
        .from(slackSearchInstallation)
        .where(
          and(
            eq(slackSearchInstallation.slackAppId, principal.appId),
            eq(slackSearchInstallation.teamId, input.team_id)
          )
        )
        .for('update')
        .limit(1)
      if (!installation) return
      if (app.app.kind === 'custom' && app.app.organizationId !== installation.organizationId)
        throw new Error('Slack installation ownership is inconsistent')
      const uninstall = input.event.type === 'app_uninstalled'
      const revokedUsers =
        input.event.type === 'tokens_revoked' ? (input.event.tokens.oauth ?? []) : []
      const revokeBot =
        uninstall ||
        (input.event.type === 'tokens_revoked' &&
          (input.event.tokens.bot ?? []).includes(installation.botUserId))
      let revokedMemberIds: string[] = []
      if (uninstall || revokedUsers.length) {
        const revokeCredentials = tx
          .update(credential)
          .set({ managedOauthStatus: 'needs_reauth', updatedAt: new Date() })
          .where(
            and(
              eq(credential.organizationId, installation.organizationId),
              eq(credential.type, 'managed_oauth'),
              eq(
                credential.authorizationAppId,
                `slack:${installation.appId}:${installation.teamId}`
              ),
              or(isNull(credential.grantedAt), lte(credential.grantedAt, occurredAt)),
              ...(uninstall ? [] : [inArray(credential.providerSubjectId, revokedUsers)])
            )
          )
        if (revokeBot) await revokeCredentials
        else {
          const revokedCredentials = await revokeCredentials.returning({
            providerSubjectId: credential.providerSubjectId,
          })
          revokedMemberIds = revokedCredentials.flatMap(({ providerSubjectId }) =>
            providerSubjectId ? [providerSubjectId] : []
          )
        }
      }
      if (revokeBot) {
        if (installation.updatedAt > occurredAt) return
        await tx
          .update(slackSearchInstallation)
          .set({
            revision: generateId(),
            enabled: false,
            lastOutcome: uninstall ? 'app_uninstalled' : 'tokens_revoked',
            updatedAt: new Date(),
          })
          .where(eq(slackSearchInstallation.id, installation.id))
      } else if (!revokedMemberIds.length) return
      await tx
        .update(slackSearchTurn)
        .set({ status: 'cancelled', outcome: 'access_revoked', updatedAt: new Date() })
        .where(
          and(
            eq(slackSearchTurn.installationId, installation.id),
            inArray(slackSearchTurn.status, ['pending', 'running']),
            ...(revokeBot
              ? []
              : [
                  inArray(
                    sql<string>`${slackSearchTurn.payload} #>> '{message,userId}'`,
                    revokedMemberIds
                  ),
                ])
          )
        )
    })
  },
}
