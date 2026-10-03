import { db } from '@sim/db'
import { slackSearchInstallation } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { loadSlackSearchCredential } from '@/lib/knowledge/application/slack-search/repository'
import { loadSlackAppConfiguration } from '@/lib/slack-search/app-configuration'

const operation = Object.freeze({
  id: 'knowledge.slack.resolve_installation',
  capability: 'none',
  principalKinds: ['slack_app'] as const,
})

/** Resolves only the app/workspace attested by the signature-verifying ingress adapter. */
export const resolveSlackAppInstallation: OperationUseCase<
  typeof operation,
  { teamId: string },
  { credentialId: string; credentialVersion: string } | null
> = {
  operation,
  async execute({ principal, input }) {
    if (
      principal.kind !== 'slack_app' ||
      !Number.isFinite(principal.receivedAt.getTime()) ||
      principal.receivedAt.getTime() > Date.now() ||
      Date.now() - principal.receivedAt.getTime() > 60_000
    )
      throw new OrchestrationError('forbidden', 'Verified Slack app authority is required')
    const configuration = await loadSlackAppConfiguration(principal.appId)
    if (!configuration || configuration.app.revision !== principal.appRevision)
      throw new OrchestrationError('forbidden', 'Slack app configuration changed')
    const [installation] = await db
      .select()
      .from(slackSearchInstallation)
      .where(
        and(
          eq(slackSearchInstallation.slackAppId, principal.appId),
          eq(slackSearchInstallation.appId, principal.appId),
          eq(slackSearchInstallation.teamId, input.teamId)
        )
      )
      .limit(1)
    if (!installation) return null
    if (
      configuration.app.kind === 'custom' &&
      configuration.app.organizationId !== installation.organizationId
    )
      throw new Error('Slack app installation ownership is inconsistent')
    const secret = await loadSlackSearchCredential(
      installation.credentialId,
      installation.organizationId
    )
    return { credentialId: installation.credentialId, credentialVersion: secret.version }
  },
}
