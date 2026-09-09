import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { credential, slackApp, slackSearchInstallation } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, ne, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  SlackSearchConfigurationError,
  SlackSearchProviderError,
  verifySlackSearchBot,
} from '@/lib/internal/slack/search-client'
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOrganizationContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { loadSlackSearchCredential } from '@/lib/knowledge/application/slack-search/repository'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'
import { slackBotCredentialVersion } from '@/lib/slack-search/app-configuration'

interface OrganizationInput {
  organizationId: string
}
interface ConfigureInput extends OrganizationInput {
  credentialId: string
  enabled: boolean
}
interface RemoveInput extends OrganizationInput {
  installationId: string
}

export const listSlackSearchInstallations = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listSlackInstallations,
  resolveContext: ({ input }: { input: OrganizationInput }) =>
    resolveKnowledgeOrganizationContext(input),
  async execute({ context }) {
    await requireOrganizationSearchAvailable(context.organizationId)
    const [installations, bots] = await Promise.all([
      db
        .select({
          id: slackSearchInstallation.id,
          credentialId: slackSearchInstallation.credentialId,
          appId: slackSearchInstallation.appId,
          teamId: slackSearchInstallation.teamId,
          teamName: slackSearchInstallation.teamName,
          enabled: slackSearchInstallation.enabled,
          lastOutcome: slackSearchInstallation.lastOutcome,
          lastEventAt: slackSearchInstallation.lastEventAt,
          credentialVersion: slackSearchInstallation.credentialVersion,
        })
        .from(slackSearchInstallation)
        .where(eq(slackSearchInstallation.organizationId, context.organizationId))
        .limit(101),
      db
        .select({
          id: credential.id,
          displayName: credential.displayName,
          encryptedKey: credential.encryptedServiceAccountKey,
          appRevision: slackApp.revision,
        })
        .from(credential)
        .leftJoin(slackApp, eq(credential.slackAppId, slackApp.id))
        .where(
          and(
            eq(credential.organizationId, context.organizationId),
            eq(credential.type, 'service_account'),
            eq(credential.providerId, SLACK_CUSTOM_BOT_PROVIDER_ID)
          )
        )
        .limit(101),
    ])
    if (installations.length > 100 || bots.length > 100)
      throw new OrchestrationError(
        'validation',
        'Slack Search supports up to 100 bots per organization'
      )
    return {
      installations: installations.map(({ credentialVersion, ...installation }) => {
        const bot = bots.find((bot) => bot.id === installation.credentialId)
        return {
          ...installation,
          needsValidation:
            !bot?.encryptedKey ||
            slackBotCredentialVersion(bot.encryptedKey, bot.appRevision ?? undefined) !==
              credentialVersion,
        }
      }),
      bots: bots.map(({ id, displayName }) => ({ id, displayName })),
    }
  },
})

export const configureSlackSearchInstallation = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.configureSlackInstallation,
  resolveContext: ({ input }: { input: ConfigureInput }) =>
    resolveKnowledgeOrganizationContext(input),
  async execute({ input, context }) {
    await requireOrganizationSearchAvailable(context.organizationId)
    const secret = input.enabled
      ? await loadSlackSearchCredential(input.credentialId, context.organizationId)
      : undefined
    let identity: Awaited<ReturnType<typeof verifySlackSearchBot>> | undefined
    if (secret) {
      try {
        identity = await verifySlackSearchBot(secret.botToken, AbortSignal.timeout(10_000))
      } catch (error) {
        if (
          error instanceof SlackSearchProviderError ||
          error instanceof SlackSearchConfigurationError
        ) {
          throw new OrchestrationError('validation', error.message)
        }
        throw error
      }
    }
    return db.transaction(async (tx) => {
      if (identity)
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`slack-search:${identity.teamId}`}, 0))`
        )
      const [current] = await tx
        .select()
        .from(credential)
        .where(
          and(
            eq(credential.id, input.credentialId),
            eq(credential.organizationId, context.organizationId)
          )
        )
        .for('update')
        .limit(1)
      if (
        !current ||
        current.type !== 'service_account' ||
        current.providerId !== SLACK_CUSTOM_BOT_PROVIDER_ID
      )
        throw new OrchestrationError('not_found', 'Organization Slack bot not found')
      const [app] = current.slackAppId
        ? await tx.select().from(slackApp).where(eq(slackApp.id, current.slackAppId)).limit(1)
        : []
      if (current.slackAppId && !app) throw new Error('Slack app configuration is missing')
      if (
        secret &&
        (!current.encryptedServiceAccountKey ||
          slackBotCredentialVersion(current.encryptedServiceAccountKey, app?.revision) !==
            secret.version)
      )
        throw new OrchestrationError('conflict', 'The bot credential changed. Validate it again.')
      const [existing] = await tx
        .select()
        .from(slackSearchInstallation)
        .where(eq(slackSearchInstallation.credentialId, current.id))
        .for('update')
        .limit(1)
      if (existing && existing.organizationId !== context.organizationId)
        throw new OrchestrationError('conflict', 'This bot is already bound to an organization')
      if (
        identity &&
        existing &&
        (identity.appId !== existing.appId || identity.teamId !== existing.teamId)
      )
        throw new OrchestrationError(
          'conflict',
          'Reconnect the same Slack app and workspace, or remove this Search binding first'
        )
      if (identity) {
        const [active] = await tx
          .select({ id: slackSearchInstallation.id })
          .from(slackSearchInstallation)
          .where(
            and(
              eq(slackSearchInstallation.teamId, identity.teamId),
              eq(slackSearchInstallation.enabled, true),
              existing ? ne(slackSearchInstallation.id, existing.id) : undefined
            )
          )
          .limit(1)
        if (active)
          throw new OrchestrationError(
            'conflict',
            'This Slack workspace already has an active Search installation'
          )
      }
      const changes = {
        enabled: input.enabled,
        revision: generateId(),
        updatedAt: new Date(),
        lastOutcome: null,
        lastEventAt: null,
      }
      if (existing) {
        const [updated] = await tx
          .update(slackSearchInstallation)
          .set({
            ...changes,
            ...(identity && secret ? { ...identity, credentialVersion: secret.version } : {}),
          })
          .where(eq(slackSearchInstallation.id, existing.id))
          .returning({ id: slackSearchInstallation.id })
        return updated
      }
      if (!identity || !secret)
        throw new OrchestrationError('not_found', 'Slack Search installation not found')
      const [created] = await tx
        .insert(slackSearchInstallation)
        .values({
          id: generateId(),
          organizationId: context.organizationId,
          credentialId: current.id,
          ...identity,
          credentialVersion: secret.version,
          ...changes,
        })
        .onConflictDoNothing()
        .returning({ id: slackSearchInstallation.id })
      if (!created)
        throw new OrchestrationError(
          'conflict',
          'This Slack app and workspace are already connected to Search'
        )
      return created
    })
  },
  projectAudit: ({ input, context, result }) => ({
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: context.organizationId,
    metadata: { setting: 'slack-search', installationId: result.id, enabled: input.enabled },
  }),
})

export const removeSlackSearchInstallation = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.removeSlackInstallation,
  resolveContext: ({ input }: { input: RemoveInput }) => resolveKnowledgeOrganizationContext(input),
  async execute({ input, context }) {
    const [removed] = await db
      .delete(slackSearchInstallation)
      .where(
        and(
          eq(slackSearchInstallation.id, input.installationId),
          eq(slackSearchInstallation.organizationId, context.organizationId)
        )
      )
      .returning({ id: slackSearchInstallation.id })
    if (!removed) throw new OrchestrationError('not_found', 'Slack Search installation not found')
    return removed
  },
  projectAudit: ({ context, result }) => ({
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: context.organizationId,
    metadata: { setting: 'slack-search', installationId: result.id, removed: true },
  }),
})
