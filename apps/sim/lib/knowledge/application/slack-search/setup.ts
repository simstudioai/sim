import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { credential, slackApp, slackSearchInstallation } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, ne, sql } from 'drizzle-orm'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  adoptOrganizationSlackMemberApp,
  loadOrganizationSlackMemberApps,
} from '@/lib/credential-groups/organization-slack-app'
import { configureSharedSlackMemberApp } from '@/lib/credential-groups/shared-slack-app'
import { exchangeSlackBotAuthorization } from '@/lib/internal/slack/oauth'
import {
  SlackSearchConfigurationError,
  SlackSearchProviderError,
  verifySlackSearchBot,
} from '@/lib/internal/slack/search-client'
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOrganizationContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { SLACK_CUSTOM_BOT_PROVIDER_ID, SLACK_CUSTOM_BOT_SECRET_TYPE } from '@/lib/oauth/types'
import { slackBotCredentialVersion } from '@/lib/slack-search/app-configuration'
import { SLACK_SEARCH_SCOPES, SLACK_SHARED_SEARCH_BOT_SCOPES } from '@/lib/slack-search/constants'
import { createSlackSearchManifest, SLACK_SEARCH_CALLBACK_PATH } from '@/lib/slack-search/manifest'
import {
  consumeSlackSearchOAuthAttempt,
  storeSlackSearchOAuthAttempt,
} from '@/lib/slack-search/oauth-state'
import { readSharedSlackSearchApp } from '@/lib/slack-search/shared-app'

interface PrepareInput {
  organizationId: string
  name: string
  description: string
}
interface StartInput extends PrepareInput {
  mode?: 'custom' | 'shared'
  installationId?: string
  clientId?: string
  clientSecret?: string
  signingSecret?: string
}
interface CompleteInput {
  state: string
  code?: string
  error?: string
}

async function existingMemberApp(organizationId: string) {
  const rows = await loadOrganizationSlackMemberApps(organizationId)
  const configurations = rows.flatMap((row) =>
    row.configuration.slack ? [row.configuration.slack] : []
  )
  const first = configurations[0]
  if (
    first &&
    configurations.some(
      (configuration) =>
        configuration.appId !== first.appId || configuration.teamId !== first.teamId
    )
  )
    throw new OrchestrationError(
      'conflict',
      'Organization Slack member accounts reference multiple apps. Consolidate them before configuring Search.'
    )
  return {
    app: first ? { appId: first.appId, teamId: first.teamId } : null,
    scopes: [...new Set(configurations.flatMap((configuration) => configuration.scopes))],
  }
}

export const prepareSlackSearchSetup = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.prepareSlackInstallation,
  resolveContext: ({ input }: { input: PrepareInput }) =>
    resolveKnowledgeOrganizationContext(input),
  async execute({ input, context }) {
    await requireOrganizationSearchAvailable(context.organizationId)
    const member = await existingMemberApp(context.organizationId)
    const manifest = createSlackSearchManifest(
      input.name,
      input.description,
      getBaseUrl(),
      member.scopes
    )
    const sharedApp = await readSharedSlackSearchApp()
    return {
      sharedAppId: sharedApp?.id ?? null,
      manifest: JSON.stringify(manifest, null, 2),
      existingApp: member.app,
      createAppUrl: `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(manifest))}`,
    }
  },
})

export const startSlackSearchSetup = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.startSlackInstallation,
  resolveContext: ({ input }: { input: StartInput }) => resolveKnowledgeOrganizationContext(input),
  async execute({ principal, input, context }) {
    if (principal.kind !== 'session') throw new Error('Slack setup requires a browser session')
    await requireOrganizationSearchAvailable(context.organizationId)
    const origin = getBaseUrl()
    createSlackSearchManifest(input.name, input.description, origin)
    const member = await existingMemberApp(context.organizationId)
    const [installation] = input.installationId
      ? await db
          .select()
          .from(slackSearchInstallation)
          .where(
            and(
              eq(slackSearchInstallation.id, input.installationId),
              eq(slackSearchInstallation.organizationId, context.organizationId)
            )
          )
          .limit(1)
      : []
    if (input.installationId && !installation)
      throw new OrchestrationError('not_found', 'Slack Search installation not found')
    const [savedApp] = installation?.slackAppId
      ? await db
          .select()
          .from(slackApp)
          .where(and(eq(slackApp.id, installation.slackAppId)))
          .limit(1)
      : []
    const shared = input.mode === 'shared'
    if (savedApp && (savedApp.kind === 'shared') !== shared)
      throw new OrchestrationError(
        'conflict',
        'Remove the existing installation before switching Slack apps'
      )
    if (savedApp?.kind === 'custom' && savedApp.organizationId !== context.organizationId)
      throw new OrchestrationError('forbidden', 'Slack app ownership changed')
    const app = shared ? await readSharedSlackSearchApp() : savedApp
    if (shared && (!app || input.clientId || input.clientSecret || input.signingSecret))
      throw new OrchestrationError(
        'validation',
        'Shared Slack app setup is unavailable or contains custom credentials'
      )
    if (shared && member.app && member.app.appId !== app?.id)
      throw new OrchestrationError(
        'conflict',
        'Remove the previous Slack source configuration before switching apps; members must reconnect'
      )
    const clientId = input.clientId ?? app?.clientId
    const encryptedClientSecret = input.clientSecret
      ? (await encryptSecret(input.clientSecret)).encrypted
      : app?.encryptedClientSecret
    const encryptedSigningSecret = input.signingSecret
      ? (await encryptSecret(input.signingSecret)).encrypted
      : app?.encryptedSigningSecret
    if (!clientId || !encryptedClientSecret || !encryptedSigningSecret)
      throw new OrchestrationError(
        'validation',
        'Client ID, Client Secret, and Signing Secret are required for a new Slack app'
      )
    const redirectUri = new URL(SLACK_SEARCH_CALLBACK_PATH, origin).href
    const state = await storeSlackSearchOAuthAttempt({
      ...(shared && app ? { sharedApp: { id: app.id, revision: app.revision } } : {}),
      userId: principal.userId,
      sessionId: principal.sessionId,
      organizationId: context.organizationId,
      name: input.name,
      description: input.description,
      ...(member.app ? { memberApp: member.app } : {}),
      clientId,
      encryptedClientSecret,
      encryptedSigningSecret,
      redirectUri,
      createdAt: Date.now(),
      ...(installation
        ? {
            installation: {
              id: installation.id,
              revision: installation.revision,
              credentialId: installation.credentialId,
              appId: installation.appId,
              teamId: installation.teamId,
              ...(app ? { appRevision: app.revision } : {}),
            },
          }
        : {}),
    })
    const url = new URL('https://slack.com/oauth/v2/authorize')
    url.search = new URLSearchParams({
      client_id: clientId,
      scope: (shared ? SLACK_SHARED_SEARCH_BOT_SCOPES : SLACK_SEARCH_SCOPES).join(','),
      redirect_uri: redirectUri,
      state,
      ...(installation ? { team: installation.teamId } : {}),
    }).toString()
    return { authorizationUrl: url.href }
  },
})

export const completeSlackSearchSetup = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.completeSlackInstallation,
  async resolveContext({
    principal,
    input,
  }: {
    principal: { kind: 'session'; userId: string; sessionId: string }
    input: CompleteInput
  }) {
    const attempt = await consumeSlackSearchOAuthAttempt(input.state, principal)
    return {
      ...(await resolveKnowledgeOrganizationContext({ organizationId: attempt.organizationId })),
      attempt,
    }
  },
  async execute({ principal, input, context }) {
    if (input.error || !input.code)
      throw new OrchestrationError(
        'validation',
        'Slack installation was not authorized. Start setup again.'
      )
    await requireOrganizationSearchAvailable(context.organizationId)
    const { attempt } = context
    if (attempt.sharedApp) {
      const app = await readSharedSlackSearchApp()
      if (app?.id !== attempt.sharedApp.id || app.revision !== attempt.sharedApp.revision)
        throw new OrchestrationError(
          'conflict',
          'Shared Slack app configuration changed. Start again.'
        )
    }
    const { decrypted: clientSecret } = await decryptSecret(attempt.encryptedClientSecret)
    const grant = await exchangeSlackBotAuthorization({
      clientId: attempt.clientId,
      clientSecret,
      code: input.code,
      redirectUri: attempt.redirectUri,
    })
    let identity: Awaited<ReturnType<typeof verifySlackSearchBot>>
    try {
      identity = await verifySlackSearchBot(
        grant.access_token,
        AbortSignal.timeout(10_000),
        attempt.sharedApp ? SLACK_SHARED_SEARCH_BOT_SCOPES : SLACK_SEARCH_SCOPES
      )
    } catch (error) {
      if (
        error instanceof SlackSearchConfigurationError ||
        error instanceof SlackSearchProviderError
      )
        throw new OrchestrationError('validation', error.message)
      throw error
    }
    if (
      (attempt.sharedApp && identity.appId !== attempt.sharedApp.id) ||
      identity.appId !== grant.app_id ||
      identity.teamId !== grant.team.id ||
      identity.botUserId !== grant.bot_user_id
    )
      throw new OrchestrationError(
        'validation',
        'Slack returned an inconsistent installation identity'
      )
    if (
      attempt.installation &&
      (attempt.installation.appId !== identity.appId ||
        attempt.installation.teamId !== identity.teamId)
    )
      throw new OrchestrationError('conflict', 'Reconnect the same Slack app and workspace')
    if (
      attempt.memberApp &&
      (attempt.memberApp.appId !== identity.appId || attempt.memberApp.teamId !== identity.teamId)
    )
      throw new OrchestrationError(
        'conflict',
        'Install the same Slack app and workspace used for member indexing'
      )
    const { encrypted: encryptedToken } = await encryptSecret(
      JSON.stringify({
        type: SLACK_CUSTOM_BOT_SECRET_TYPE,
        botToken: grant.access_token,
        teamId: identity.teamId,
        botUserId: identity.botUserId,
        teamName: identity.teamName,
      })
    )
    await authorizeOrganizationOperation(
      principal,
      knowledgeOperations.completeSlackInstallation.organizationOperation,
      context
    )
    await db.transaction(async (tx) => {
      /** Serialize app/workspace installs before checking ownership or inserting missing rows. */
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`slack-search:${identity.teamId}`}, 0))`
      )
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`slack-app:${identity.appId}`}, 0))`
      )
      const [existingApp] = await tx
        .select()
        .from(slackApp)
        .where(eq(slackApp.id, identity.appId))
        .for('update')
        .limit(1)
      if (
        attempt.sharedApp
          ? !existingApp ||
            existingApp.kind !== 'shared' ||
            existingApp.organizationId !== null ||
            existingApp.revision !== attempt.sharedApp.revision
          : existingApp &&
            (existingApp.kind !== 'custom' || existingApp.organizationId !== context.organizationId)
      )
        throw new OrchestrationError(
          'conflict',
          'This Slack app belongs to another installation owner'
        )
      if (
        attempt.installation?.appRevision &&
        existingApp?.revision !== attempt.installation.appRevision
      )
        throw new OrchestrationError(
          'conflict',
          'The Slack app credentials changed during setup. Start again.'
        )
      const [existing] = await tx
        .select()
        .from(slackSearchInstallation)
        .where(
          attempt.installation
            ? eq(slackSearchInstallation.id, attempt.installation.id)
            : and(
                eq(slackSearchInstallation.appId, identity.appId),
                eq(slackSearchInstallation.teamId, identity.teamId)
              )
        )
        .for('update')
        .limit(1)
      if (
        attempt.installation &&
        (!existing ||
          existing.revision !== attempt.installation.revision ||
          existing.credentialId !== attempt.installation.credentialId)
      )
        throw new OrchestrationError(
          'conflict',
          'This installation changed during setup. Start setup again.'
        )
      if (existing && (!attempt.installation || existing.organizationId !== context.organizationId))
        throw new OrchestrationError(
          'conflict',
          'This app is already connected. Use Reconnect on its existing installation.'
        )
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
      const appRevision = attempt.sharedApp?.revision ?? generateId()
      const appValues = {
        id: identity.appId,
        kind: 'custom' as const,
        organizationId: context.organizationId,
        clientId: attempt.clientId,
        encryptedClientSecret: attempt.encryptedClientSecret,
        encryptedSigningSecret: attempt.encryptedSigningSecret,
        revision: appRevision,
        updatedAt: new Date(),
      }
      if (!attempt.sharedApp)
        await tx
          .insert(slackApp)
          .values(appValues)
          .onConflictDoUpdate({ target: slackApp.id, set: appValues })
      await adoptOrganizationSlackMemberApp(
        tx,
        context.organizationId,
        identity.appId,
        identity.teamId,
        attempt.clientId
      )
      if (attempt.sharedApp)
        await configureSharedSlackMemberApp(tx, {
          organizationId: context.organizationId,
          userId: principal.userId,
          appId: identity.appId,
          teamId: identity.teamId,
        })
      const credentialId = existing?.credentialId ?? generateId()
      const credentialValues = {
        slackAppId: identity.appId,
        displayName: attempt.name,
        description: attempt.description,
        encryptedServiceAccountKey: encryptedToken,
        updatedAt: new Date(),
      }
      if (existing) {
        const [updated] = await tx
          .update(credential)
          .set(credentialValues)
          .where(
            and(
              eq(credential.id, credentialId),
              eq(credential.organizationId, context.organizationId),
              eq(credential.type, 'service_account'),
              eq(credential.providerId, SLACK_CUSTOM_BOT_PROVIDER_ID)
            )
          )
          .returning({ id: credential.id })
        if (!updated)
          throw new OrchestrationError(
            'conflict',
            'Slack bot credential no longer belongs to this organization'
          )
      } else {
        await tx.insert(credential).values({
          id: credentialId,
          organizationId: context.organizationId,
          workspaceId: null,
          type: 'service_account',
          providerId: SLACK_CUSTOM_BOT_PROVIDER_ID,
          createdBy: principal.userId,
          ...credentialValues,
        })
      }
      const installationValues = {
        ...identity,
        slackAppId: identity.appId,
        credentialVersion: slackBotCredentialVersion(encryptedToken, appRevision),
        enabled: true,
        revision: generateId(),
        lastOutcome: null,
        lastEventAt: null,
        updatedAt: new Date(),
      }
      if (existing)
        await tx
          .update(slackSearchInstallation)
          .set(installationValues)
          .where(eq(slackSearchInstallation.id, existing.id))
      else
        await tx.insert(slackSearchInstallation).values({
          id: generateId(),
          organizationId: context.organizationId,
          credentialId,
          ...installationValues,
        })
    })
    return { organizationId: context.organizationId }
  },
  projectAudit: ({ context }) => ({
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: context.organizationId,
    metadata: { setting: 'slack-search', connected: true },
  }),
})
