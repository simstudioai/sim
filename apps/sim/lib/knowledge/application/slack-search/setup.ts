import { AuditAction, AuditResourceType } from '@sim/audit'
import type { SessionPrincipal } from '@sim/auth/principal'
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
import type { DbOrTx } from '@/lib/db/types'
import { buildSlackAppCreationUrl } from '@/lib/integrations/slack-manifest'
import {
  exchangeSlackBotAuthorization,
  revokeSlackBotAuthorization,
  validateSlackBotAuthorization,
} from '@/lib/internal/slack/oauth'
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
  type SlackSearchOAuthAttempt,
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

async function existingMemberApp(organizationId: string, executor: DbOrTx = db) {
  const rows = await loadOrganizationSlackMemberApps(organizationId, executor)
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
    const sharedApp = await readSharedSlackSearchApp(context.organizationId)
    return {
      sharedAppId: sharedApp?.id ?? null,
      manifest: JSON.stringify(manifest, null, 2),
      existingApp: member.app,
      createAppUrl: buildSlackAppCreationUrl(JSON.stringify(manifest)),
    }
  },
})

async function prepareInstallationAttempt(
  principal: SessionPrincipal,
  input: StartInput
): Promise<SlackSearchOAuthAttempt> {
  const origin = getBaseUrl()
  const member = await existingMemberApp(input.organizationId)
  const [installation] = input.installationId
    ? await db
        .select()
        .from(slackSearchInstallation)
        .where(
          and(
            eq(slackSearchInstallation.id, input.installationId),
            eq(slackSearchInstallation.organizationId, input.organizationId)
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
  if (installation?.slackAppId && !savedApp)
    throw new OrchestrationError('conflict', 'Slack app configuration is missing')
  const transitioning = shared && installation && savedApp?.kind !== 'shared'
  if (savedApp?.kind === 'shared' && !shared)
    throw new OrchestrationError(
      'conflict',
      'Remove the existing installation before switching Slack apps'
    )
  if (savedApp?.kind === 'custom' && savedApp.organizationId !== input.organizationId)
    throw new OrchestrationError('forbidden', 'Slack app ownership changed')
  const sharedApp = shared ? await readSharedSlackSearchApp(input.organizationId) : null
  const app = shared ? sharedApp : savedApp
  if (shared && (!app || input.clientId || input.clientSecret || input.signingSecret))
    throw new OrchestrationError(
      'validation',
      'Shared Slack app setup is unavailable or contains custom credentials'
    )
  if (shared && installation && member.app && member.app.teamId !== installation.teamId)
    throw new OrchestrationError(
      'conflict',
      'Install Sim Search in the Slack workspace connected by your members'
    )
  const clientId = input.clientId ?? app?.clientId
  if (!clientId) throw new OrchestrationError('validation', 'Slack Client ID is required')
  let appCredentials:
    | { sharedApp: { id: string; revision: string } }
    | { encryptedClientSecret: string; encryptedSigningSecret: string }
  if (sharedApp) {
    appCredentials = { sharedApp: { id: sharedApp.id, revision: sharedApp.revision } }
  } else {
    const encryptedClientSecret = input.clientSecret
      ? (await encryptSecret(input.clientSecret)).encrypted
      : savedApp?.encryptedClientSecret
    const encryptedSigningSecret = input.signingSecret
      ? (await encryptSecret(input.signingSecret)).encrypted
      : savedApp?.encryptedSigningSecret
    if (!encryptedClientSecret || !encryptedSigningSecret)
      throw new OrchestrationError(
        'validation',
        'Client ID, Client Secret, and Signing Secret are required for a new Slack app'
      )
    appCredentials = { encryptedClientSecret, encryptedSigningSecret }
  }
  const redirectUri = new URL(SLACK_SEARCH_CALLBACK_PATH, origin).href
  const installationSnapshot = installation
    ? {
        id: installation.id,
        revision: installation.revision,
        credentialId: installation.credentialId,
        appId: installation.appId,
        teamId: installation.teamId,
        ...(savedApp ? { appRevision: savedApp.revision } : {}),
      }
    : undefined
  return {
    ...appCredentials,
    userId: principal.userId,
    sessionId: principal.sessionId,
    organizationId: input.organizationId,
    name: input.name,
    description: input.description,
    ...(member.app ? { memberApp: member.app } : {}),
    clientId,
    redirectUri,
    createdAt: Date.now(),
    ...(installationSnapshot
      ? transitioning
        ? { customInstallation: installationSnapshot }
        : { installation: installationSnapshot }
      : {}),
  }
}

export const startSlackSearchSetup = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.startSlackInstallation,
  resolveContext: ({ input }: { input: StartInput }) => resolveKnowledgeOrganizationContext(input),
  async execute({ principal, input, context }) {
    if (principal.kind !== 'session') throw new Error('Slack setup requires a browser session')
    await requireOrganizationSearchAvailable(context.organizationId)
    const attempt = await prepareInstallationAttempt(principal, input)
    const state = await storeSlackSearchOAuthAttempt(attempt)
    const installation = attempt.installation ?? attempt.customInstallation
    const url = new URL('https://slack.com/oauth/v2/authorize')
    url.search = new URLSearchParams({
      client_id: attempt.clientId,
      scope: (attempt.sharedApp ? SLACK_SHARED_SEARCH_BOT_SCOPES : SLACK_SEARCH_SCOPES).join(','),
      redirect_uri: attempt.redirectUri,
      state,
      ...(installation ? { team: installation.teamId } : {}),
    }).toString()
    return { authorizationUrl: url.href }
  },
})

/** Cleanup shares installation locks; an existing bot must never be revoked by a failed setup. */
async function revokeUninstalledSharedGrant(
  grant: Awaited<ReturnType<typeof exchangeSlackBotAuthorization>>
) {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`slack-search:${grant.team.id}`}, 0))`
      )
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`slack-app:${grant.app_id}`}, 0))`
      )
      const [installation] = await tx
        .select({ id: slackSearchInstallation.id })
        .from(slackSearchInstallation)
        .where(
          and(
            eq(slackSearchInstallation.appId, grant.app_id),
            eq(slackSearchInstallation.teamId, grant.team.id)
          )
        )
        .limit(1)
      if (installation) return
      await revokeSlackBotAuthorization(grant.access_token)
    })
  } catch {
    throw new OrchestrationError(
      'validation',
      'Slack setup failed and token cleanup could not be verified. Remove the unused app in Slack before retrying.'
    )
  }
}

/** Persists verified installs under the same ownership and revision locks for both setup paths. */
async function saveInstallation(
  attempt: SlackSearchOAuthAttempt,
  identity: Awaited<ReturnType<typeof verifySlackSearchBot>>,
  botToken: string,
  userId: string
) {
  if (
    attempt.installation &&
    (attempt.installation.appId !== identity.appId ||
      attempt.installation.teamId !== identity.teamId)
  )
    throw new OrchestrationError('conflict', 'Reconnect the same Slack app and workspace')
  if (
    attempt.customInstallation &&
    (attempt.customInstallation.teamId !== identity.teamId ||
      attempt.customInstallation.appId === identity.appId)
  )
    throw new OrchestrationError('conflict', 'Install Sim Search in the same Slack workspace')
  if (
    attempt.memberApp &&
    ((!attempt.sharedApp && attempt.memberApp.appId !== identity.appId) ||
      attempt.memberApp.teamId !== identity.teamId)
  )
    throw new OrchestrationError(
      'conflict',
      'Install the same Slack app and workspace connected by your members'
    )
  const { encrypted: encryptedToken } = await encryptSecret(
    JSON.stringify({
      type: SLACK_CUSTOM_BOT_SECRET_TYPE,
      botToken,
      teamId: identity.teamId,
      botUserId: identity.botUserId,
      teamName: identity.teamName,
    })
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
        ? existingApp && (existingApp.kind !== 'shared' || existingApp.organizationId !== null)
        : existingApp &&
          (existingApp.kind !== 'custom' || existingApp.organizationId !== attempt.organizationId)
    )
      throw new OrchestrationError(
        'conflict',
        'This Slack app belongs to another installation owner'
      )
    if (
      !attempt.sharedApp &&
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
    if (existing && (!attempt.installation || existing.organizationId !== attempt.organizationId))
      throw new OrchestrationError(
        'conflict',
        'This app is already connected. Use Reconnect on its existing installation.'
      )
    const [customInstallation] = attempt.customInstallation
      ? await tx
          .select()
          .from(slackSearchInstallation)
          .where(
            and(
              eq(slackSearchInstallation.id, attempt.customInstallation.id),
              eq(slackSearchInstallation.organizationId, attempt.organizationId)
            )
          )
          .for('update')
          .limit(1)
      : []
    if (
      attempt.customInstallation &&
      (!customInstallation ||
        customInstallation.organizationId !== attempt.organizationId ||
        customInstallation.revision !== attempt.customInstallation.revision ||
        customInstallation.credentialId !== attempt.customInstallation.credentialId ||
        customInstallation.appId !== attempt.customInstallation.appId ||
        customInstallation.teamId !== identity.teamId)
    )
      throw new OrchestrationError(
        'conflict',
        'The custom bot changed during setup. Start setup again.'
      )
    const [active] = await tx
      .select({ id: slackSearchInstallation.id })
      .from(slackSearchInstallation)
      .where(
        and(
          eq(slackSearchInstallation.teamId, identity.teamId),
          eq(slackSearchInstallation.enabled, true),
          existing ? ne(slackSearchInstallation.id, existing.id) : undefined,
          customInstallation ? ne(slackSearchInstallation.id, customInstallation.id) : undefined
        )
      )
      .limit(1)
    if (active)
      throw new OrchestrationError(
        'conflict',
        'This Slack workspace already has an active Search installation'
      )
    if (attempt.sharedApp) {
      const currentApp = await readSharedSlackSearchApp(attempt.organizationId)
      if (
        currentApp?.id !== attempt.sharedApp.id ||
        currentApp.revision !== attempt.sharedApp.revision
      )
        throw new OrchestrationError('conflict', 'Shared Slack app configuration changed')
      /** A concurrent failed setup may have revoked an uncommitted grant while we waited. */
      const current = await verifySlackSearchBot(
        botToken,
        AbortSignal.timeout(10_000),
        SLACK_SHARED_SEARCH_BOT_SCOPES
      )
      if (
        current.appId !== identity.appId ||
        current.teamId !== identity.teamId ||
        current.botUserId !== identity.botUserId
      )
        throw new OrchestrationError(
          'validation',
          'Slack installation identity changed during setup'
        )
    }
    const appRevision = attempt.sharedApp?.revision ?? generateId()
    if (attempt.sharedApp) {
      /** The row supplies foreign-key identity only; shared secrets remain in the environment. */
      await tx
        .insert(slackApp)
        .values({
          id: identity.appId,
          kind: 'shared',
          organizationId: null,
          revision: appRevision,
        })
        .onConflictDoNothing()
    } else {
      const appValues = {
        id: identity.appId,
        kind: 'custom' as const,
        organizationId: attempt.organizationId,
        clientId: attempt.clientId,
        encryptedClientSecret: attempt.encryptedClientSecret,
        encryptedSigningSecret: attempt.encryptedSigningSecret,
        revision: appRevision,
        updatedAt: new Date(),
      }
      await tx
        .insert(slackApp)
        .values(appValues)
        .onConflictDoUpdate({ target: slackApp.id, set: appValues })
    }
    const member = await existingMemberApp(attempt.organizationId, tx)
    if (
      member.app?.appId !== attempt.memberApp?.appId ||
      member.app?.teamId !== attempt.memberApp?.teamId
    )
      throw new OrchestrationError('conflict', 'Slack source configuration changed during setup')
    /** A bot transition leaves existing personal grants and indexing configuration untouched. */
    const preserveMemberApp = attempt.sharedApp && member.app && member.app.appId !== identity.appId
    if (!preserveMemberApp)
      await adoptOrganizationSlackMemberApp(
        tx,
        attempt.organizationId,
        identity.appId,
        identity.teamId,
        attempt.clientId
      )
    if (attempt.sharedApp && !preserveMemberApp)
      await configureSharedSlackMemberApp(tx, {
        organizationId: attempt.organizationId,
        userId,
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
            eq(credential.organizationId, attempt.organizationId),
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
        organizationId: attempt.organizationId,
        workspaceId: null,
        type: 'service_account',
        providerId: SLACK_CUSTOM_BOT_PROVIDER_ID,
        createdBy: userId,
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
    if (customInstallation)
      await tx
        .update(slackSearchInstallation)
        .set({ enabled: false, revision: generateId(), updatedAt: new Date() })
        .where(eq(slackSearchInstallation.id, customInstallation.id))
    if (existing)
      await tx
        .update(slackSearchInstallation)
        .set(installationValues)
        .where(eq(slackSearchInstallation.id, existing.id))
    else
      await tx.insert(slackSearchInstallation).values({
        id: generateId(),
        organizationId: attempt.organizationId,
        credentialId,
        ...installationValues,
      })
  })
}

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
    if (attempt.customInstallation && (!attempt.sharedApp || attempt.installation))
      throw new OrchestrationError('validation', 'Invalid Slack app transition')
    let clientSecret: string
    if (attempt.sharedApp) {
      const app = await readSharedSlackSearchApp(context.organizationId)
      if (
        app?.id !== attempt.sharedApp.id ||
        app.revision !== attempt.sharedApp.revision ||
        app.clientId !== attempt.clientId
      )
        throw new OrchestrationError(
          'conflict',
          'Shared Slack app configuration changed. Start again.'
        )
      clientSecret = app.clientSecret
    } else {
      clientSecret = (await decryptSecret(attempt.encryptedClientSecret)).decrypted
    }
    const grant = await exchangeSlackBotAuthorization({
      clientId: attempt.clientId,
      clientSecret,
      code: input.code,
      redirectUri: attempt.redirectUri,
    })
    try {
      validateSlackBotAuthorization(
        grant,
        attempt.sharedApp ? SLACK_SHARED_SEARCH_BOT_SCOPES : SLACK_SEARCH_SCOPES
      )
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
      await authorizeOrganizationOperation(
        principal,
        knowledgeOperations.completeSlackInstallation.organizationOperation,
        context
      )
      await saveInstallation(attempt, identity, grant.access_token, principal.userId)
    } catch (error) {
      if (attempt.sharedApp) await revokeUninstalledSharedGrant(grant)
      throw error
    }
    return { organizationId: context.organizationId }
  },
  projectAudit: ({ context }) => ({
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: context.organizationId,
    metadata: {
      setting: 'slack-search',
      connected: true,
      ...(context.attempt.customInstallation
        ? { previousInstallationId: context.attempt.customInstallation.id }
        : {}),
    },
  }),
})

interface ConnectCustomInput extends Omit<StartInput, 'mode'> {
  botToken: string
}

/** Connects the bot already installed by Slack's manifest flow without issuing another grant. */
export const connectCustomSlackSearch = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.connectCustomSlackInstallation,
  resolveContext: ({ input }: { input: ConnectCustomInput }) =>
    resolveKnowledgeOrganizationContext(input),
  async execute({ principal, input, context }) {
    await requireOrganizationSearchAvailable(context.organizationId)
    if (!input.botToken.startsWith('xoxb-'))
      throw new OrchestrationError(
        'validation',
        'Use a Bot User OAuth Token (xoxb-) with token rotation disabled.'
      )
    const attempt = await prepareInstallationAttempt(principal, { ...input, mode: 'custom' })
    let identity: Awaited<ReturnType<typeof verifySlackSearchBot>>
    try {
      identity = await verifySlackSearchBot(input.botToken, AbortSignal.timeout(10_000))
    } catch (error) {
      if (
        error instanceof SlackSearchConfigurationError ||
        error instanceof SlackSearchProviderError
      )
        throw new OrchestrationError('validation', error.message)
      throw error
    }
    await authorizeOrganizationOperation(
      principal,
      knowledgeOperations.connectCustomSlackInstallation.organizationOperation,
      context
    )
    await saveInstallation(attempt, identity, input.botToken, principal.userId)
    return { organizationId: context.organizationId }
  },
  projectAudit: ({ context }) => ({
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: context.organizationId,
    metadata: { setting: 'slack-search', connected: true },
  }),
})
