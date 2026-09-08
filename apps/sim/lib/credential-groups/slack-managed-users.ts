import { Buffer } from 'node:buffer'
import { db } from '@sim/db'
import { credential, credentialGroup, credentialGroupEnrollment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getRedisClient } from '@/lib/core/config/redis'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { credentialGroupScopePolicyVersion } from '@/lib/credential-groups/provider-adapter'
import {
  decryptCredentialGroupProviderConfiguration,
  encryptCredentialGroupProviderConfiguration,
} from '@/lib/credential-groups/provider-configuration'
import {
  resolveSlackManagedUserScopes,
  SLACK_MANAGED_USER_CONFIGURATION_CALLBACK_PATH,
  SLACK_SEARCH_USER_SCOPES,
} from '@/lib/credential-groups/slack-managed-user-scopes'
import type { DbOrTx } from '@/lib/db/types'
import { SLACK_CUSTOM_BOT_PROVIDER_ID, SLACK_CUSTOM_BOT_SECRET_TYPE } from '@/lib/oauth/types'

const logger = createLogger('SlackManagedUsers')
const SLACK_MANAGED_USERS_ATTEMPT_TTL_MS = 10 * 60 * 1000
const SLACK_MANAGED_USERS_ATTEMPT_VERSION = 4 as const
const MAX_SLACK_RESPONSE_BYTES = 64 * 1024
const CONSUME_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then
  return nil
end
redis.call('DEL', KEYS[1])
return value
`

interface SlackCustomBotSecret {
  type: typeof SLACK_CUSTOM_BOT_SECRET_TYPE
  signingSecret: string
  botToken: string
  teamId: string
  botUserId?: string
  teamName?: string
  metadata?: Record<string, string>
}

interface StoredSlackManagedUsersAttempt {
  version: typeof SLACK_MANAGED_USERS_ATTEMPT_VERSION
  workspaceId?: string
  organizationId?: string
  userId: string
  credentialGroupId: string
  credentialGroupUpdatedAt: number
  slackBotCredentialId?: string
  slackBotCredentialUpdatedAt?: number
  expectedAppId: string
  expectedTeamId: string
  clientId: string
  encryptedClientSecret: string
  redirectUri: string
  requiredScopes: string[]
  createdAt: number
}

export interface SlackManagedUsersAttempt {
  workspaceId?: string
  organizationId?: string
  userId: string
  credentialGroupId: string
  credentialGroupUpdatedAt: number
  slackBotCredentialId?: string
  slackBotCredentialUpdatedAt?: number
  expectedAppId: string
  expectedTeamId: string
  clientId: string
  clientSecret: string
  redirectUri: string
  requiredScopes: string[]
  createdAt: number
}

export interface SlackOAuthSuccess {
  appId: string
  teamId: string
  teamName: string
  userId: string
  accessToken: string
  scopes: string[]
  tokenType: 'user'
  expiresIn?: number
  refreshToken?: string
}

export interface VerifiedSlackUserIdentity {
  userId: string
  teamId: string
  email: string
  displayName?: string
  avatarUrl?: string
  username?: string
}

export class SlackManagedUsersError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_state'
      | 'provider_error'
      | 'invalid_client'
      | 'invalid_response'
      | 'missing_bot_scope'
      | 'token_rotation_enabled'
      | 'revoke_failed'
  ) {
    super(message)
    this.name = 'SlackManagedUsersError'
  }
}

function requireRedis() {
  const redis = getRedisClient()
  if (!redis) throw new Error('Slack managed-user setup requires Redis')
  return redis
}

function attemptKey(state: string): string {
  return `credential-group:slack-managed-users:${sha256Hex(state)}`
}

function isStoredAttempt(value: unknown): value is StoredSlackManagedUsersAttempt {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.version === SLACK_MANAGED_USERS_ATTEMPT_VERSION &&
    ((typeof candidate.workspaceId === 'string' &&
      candidate.workspaceId.length > 0 &&
      candidate.organizationId === undefined) ||
      (typeof candidate.organizationId === 'string' &&
        candidate.organizationId.length > 0 &&
        candidate.workspaceId === undefined)) &&
    typeof candidate.userId === 'string' &&
    typeof candidate.credentialGroupId === 'string' &&
    typeof candidate.credentialGroupUpdatedAt === 'number' &&
    (candidate.organizationId !== undefined
      ? candidate.slackBotCredentialId === undefined &&
        candidate.slackBotCredentialUpdatedAt === undefined
      : typeof candidate.slackBotCredentialId === 'string' &&
        typeof candidate.slackBotCredentialUpdatedAt === 'number') &&
    typeof candidate.expectedAppId === 'string' &&
    typeof candidate.expectedTeamId === 'string' &&
    typeof candidate.clientId === 'string' &&
    typeof candidate.encryptedClientSecret === 'string' &&
    typeof candidate.redirectUri === 'string' &&
    Array.isArray(candidate.requiredScopes) &&
    candidate.requiredScopes.length > 0 &&
    candidate.requiredScopes.length <= 100 &&
    candidate.requiredScopes.every(
      (scope) => typeof scope === 'string' && scope.length > 0 && scope.length <= 255
    ) &&
    typeof candidate.createdAt === 'number'
  )
}

function parseSlackCustomBotSecret(value: unknown): SlackCustomBotSecret {
  if (!value || typeof value !== 'object') {
    throw new Error('Slack custom bot secret is malformed')
  }
  const candidate = value as Record<string, unknown>
  if (
    candidate.type !== SLACK_CUSTOM_BOT_SECRET_TYPE ||
    typeof candidate.signingSecret !== 'string' ||
    typeof candidate.botToken !== 'string' ||
    typeof candidate.teamId !== 'string'
  ) {
    throw new Error('Slack custom bot secret is malformed')
  }
  return {
    type: SLACK_CUSTOM_BOT_SECRET_TYPE,
    signingSecret: candidate.signingSecret,
    botToken: candidate.botToken,
    teamId: candidate.teamId,
    ...(typeof candidate.botUserId === 'string' ? { botUserId: candidate.botUserId } : {}),
    ...(typeof candidate.teamName === 'string' ? { teamName: candidate.teamName } : {}),
    ...(candidate.metadata && typeof candidate.metadata === 'object'
      ? { metadata: candidate.metadata as Record<string, string> }
      : {}),
  }
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' && field.length > 0 ? field : null
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SLACK_RESPONSE_BYTES) {
    throw new SlackManagedUsersError('Slack returned an oversized response.', 'invalid_response')
  }
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_SLACK_RESPONSE_BYTES) {
    throw new SlackManagedUsersError('Slack returned an oversized response.', 'invalid_response')
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new SlackManagedUsersError('Slack returned an invalid response.', 'invalid_response')
  }
}

function parseSlackOAuthResponse(value: unknown): SlackOAuthSuccess {
  if (!value || typeof value !== 'object') {
    throw new SlackManagedUsersError('Slack returned an invalid response.', 'invalid_response')
  }
  const response = value as Record<string, unknown>
  if (response.ok !== true) {
    const errorCode = stringField(response, 'error')
    throw new SlackManagedUsersError(
      errorCode === 'invalid_client_id' || errorCode === 'bad_client_secret'
        ? 'Slack rejected the Client ID or Client Secret.'
        : 'Slack could not verify this app.',
      errorCode === 'invalid_client_id' || errorCode === 'bad_client_secret'
        ? 'invalid_client'
        : 'provider_error'
    )
  }

  const appId = stringField(response, 'app_id')
  const team = response.team
  const teamId = stringField(team, 'id')
  const teamName = stringField(team, 'name')
  const authedUser = response.authed_user
  const userId = stringField(authedUser, 'id')
  const accessToken = stringField(authedUser, 'access_token')
  const tokenType = stringField(authedUser, 'token_type')
  const scope = stringField(authedUser, 'scope')
  if (
    !appId?.startsWith('A') ||
    !teamId?.startsWith('T') ||
    !teamName ||
    !userId?.startsWith('U') ||
    !accessToken ||
    tokenType !== 'user' ||
    !scope
  ) {
    throw new SlackManagedUsersError(
      'Slack returned an incomplete authorization.',
      'invalid_response'
    )
  }

  const expiresIn =
    authedUser && typeof authedUser === 'object'
      ? (authedUser as Record<string, unknown>).expires_in
      : undefined
  const refreshToken = stringField(authedUser, 'refresh_token') ?? undefined
  return {
    appId,
    teamId,
    teamName,
    userId,
    accessToken,
    scopes: scope
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    tokenType: 'user',
    ...(typeof expiresIn === 'number' ? { expiresIn } : {}),
    ...(refreshToken ? { refreshToken } : {}),
  }
}

export async function revokeSlackToken(token: string): Promise<void> {
  const response = await fetch('https://slack.com/api/auth.revoke', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    cache: 'no-store',
  })
  const value = await readBoundedJson(response)
  if (
    !response.ok ||
    !value ||
    typeof value !== 'object' ||
    (value as Record<string, unknown>).ok !== true ||
    (value as Record<string, unknown>).revoked !== true
  ) {
    throw new SlackManagedUsersError(
      'Slack issued a setup token but could not revoke it. Try again.',
      'revoke_failed'
    )
  }
}

async function callSlackApi(method: string, accessToken: string, body?: URLSearchParams) {
  let response: Response
  try {
    response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      ...(body ? { body } : {}),
      cache: 'no-store',
    })
  } catch (error) {
    logger.error('Slack API verification failed', { method, error: getErrorMessage(error) })
    throw new SlackManagedUsersError('Slack could not verify the authorization.', 'provider_error')
  }
  const value = await readBoundedJson(response)
  if (
    !response.ok ||
    !value ||
    typeof value !== 'object' ||
    (value as Record<string, unknown>).ok !== true
  ) {
    const providerError = stringField(value, 'error')
    if (method === 'bots.info' && providerError === 'missing_scope') {
      throw new SlackManagedUsersError(
        'Add the users:read bot scope to this Slack app, reinstall it, and update the custom bot credential before enabling managed users.',
        'missing_bot_scope'
      )
    }
    throw new SlackManagedUsersError('Slack could not verify the authorization.', 'provider_error')
  }
  return value as Record<string, unknown>
}

export async function verifySlackCustomBotAppIdentity(botToken: string): Promise<{
  appId: string
  teamId: string
}> {
  const auth = await callSlackApi('auth.test', botToken)
  const teamId = stringField(auth, 'team_id')
  const botId = stringField(auth, 'bot_id')
  if (!teamId?.startsWith('T') || !botId?.startsWith('B')) {
    throw new SlackManagedUsersError(
      'Slack did not identify this token as an installed bot.',
      'invalid_response'
    )
  }
  const info = await callSlackApi('bots.info', botToken, new URLSearchParams({ bot: botId }))
  const appId = stringField(info.bot, 'app_id')
  if (!appId?.startsWith('A')) {
    throw new SlackManagedUsersError(
      'Slack did not return the app for this custom bot.',
      'invalid_response'
    )
  }
  return { appId, teamId }
}

export async function verifySlackUserIdentity(params: {
  accessToken: string
  expectedTeamId: string
  expectedUserId: string
}): Promise<VerifiedSlackUserIdentity> {
  const auth = await callSlackApi('auth.test', params.accessToken)
  const teamId = stringField(auth, 'team_id')
  const userId = stringField(auth, 'user_id')
  if (teamId !== params.expectedTeamId || userId !== params.expectedUserId) {
    throw new SlackManagedUsersError(
      'Slack returned a credential for another user or workspace.',
      'invalid_response'
    )
  }

  const info = await callSlackApi(
    'users.info',
    params.accessToken,
    new URLSearchParams({ user: params.expectedUserId })
  )
  const user = info.user
  if (!user || typeof user !== 'object') {
    throw new SlackManagedUsersError(
      'Slack returned an incomplete user profile.',
      'invalid_response'
    )
  }
  const profile = (user as Record<string, unknown>).profile
  const email = stringField(profile, 'email')
  if (!email) {
    throw new SlackManagedUsersError(
      'Slack did not return the user email required by this invitation.',
      'invalid_response'
    )
  }
  const displayName = stringField(profile, 'display_name') ?? stringField(profile, 'real_name')
  const avatarUrl = stringField(profile, 'image_192') ?? stringField(profile, 'image_72')
  const username = stringField(user, 'name')
  return {
    userId,
    teamId,
    email,
    ...(displayName ? { displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(username ? { username } : {}),
  }
}

export async function exchangeSlackUserAuthorization(params: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
}): Promise<SlackOAuthSuccess> {
  const basicAuth = Buffer.from(`${params.clientId}:${params.clientSecret}`, 'utf8').toString(
    'base64'
  )
  const body = new URLSearchParams({ code: params.code, redirect_uri: params.redirectUri })
  let response: Response
  try {
    response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      cache: 'no-store',
    })
  } catch (error) {
    logger.error('Slack OAuth exchange failed', { error: getErrorMessage(error) })
    throw new SlackManagedUsersError('Slack could not complete authorization.', 'provider_error')
  }
  return parseSlackOAuthResponse(await readBoundedJson(response))
}

export function getSlackManagedUsersRedirectUri(): string {
  return `${getBaseUrl()}${SLACK_MANAGED_USER_CONFIGURATION_CALLBACK_PATH}`
}

export async function createSlackManagedUsersAttempt(params: {
  workspaceId?: string
  organizationId?: string
  userId: string
  credentialGroupId: string
  slackBotCredentialId?: string
  appId?: string
  teamId?: string
  clientId: string
  clientSecret: string
  requiredScopes?: string[]
}): Promise<{ state: string; authorizationUrl: string }> {
  const scope = resourceScopeFromOwner(params)
  const [group] = await db
    .select({
      id: credentialGroup.id,
      updatedAt: credentialGroup.updatedAt,
      options: credentialGroup.options,
    })
    .from(credentialGroup)
    .where(
      and(
        eq(credentialGroup.id, params.credentialGroupId),
        resourceScopeCondition(credentialGroup, scope)
      )
    )
    .limit(1)
  if (!group) throw new SlackManagedUsersError('Credential Group not found.', 'invalid_response')
  const existingOption = group.options?.find((option) => option.provider === 'slack')
  const requiredScopes = resolveSlackManagedUserScopes(
    params.requiredScopes ??
      existingOption?.requiredScopes ??
      (existingOption ? undefined : SLACK_SEARCH_USER_SCOPES)
  )
  let bot: Awaited<ReturnType<typeof getSlackCustomBotCredential>> = null
  let identity: { appId: string; teamId: string }
  if (scope.kind === 'organization') {
    if (
      params.slackBotCredentialId ||
      !params.appId?.match(/^A[A-Z0-9]+$/) ||
      !params.teamId?.match(/^T[A-Z0-9]+$/)
    )
      throw new SlackManagedUsersError(
        'Organization Slack setup requires an App ID and workspace ID.',
        'invalid_response'
      )
    identity = { appId: params.appId, teamId: params.teamId }
  } else {
    if (!params.slackBotCredentialId)
      throw new SlackManagedUsersError('Select a custom Slack bot.', 'invalid_response')
    bot = await getSlackCustomBotCredential({
      ...resourceScopeFields(scope),
      credentialId: params.slackBotCredentialId,
    })
    if (!bot) throw new SlackManagedUsersError('Custom Slack bot not found.', 'invalid_response')
    identity = await verifySlackCustomBotAppIdentity(bot.botToken)
    if (identity.teamId !== bot.teamId)
      throw new SlackManagedUsersError(
        'The bot no longer belongs to its stored Slack workspace.',
        'invalid_response'
      )
  }
  const redis = requireRedis()
  const state = generateId()
  const redirectUri = getSlackManagedUsersRedirectUri()
  const encryptedClientSecret = await encryptSecret(params.clientSecret)
  const attempt: StoredSlackManagedUsersAttempt = {
    version: SLACK_MANAGED_USERS_ATTEMPT_VERSION,
    ...resourceScopeFields(scope),
    userId: params.userId,
    credentialGroupId: group.id,
    credentialGroupUpdatedAt: group.updatedAt.getTime(),
    ...(bot
      ? { slackBotCredentialId: bot.id, slackBotCredentialUpdatedAt: bot.updatedAt.getTime() }
      : {}),
    expectedAppId: identity.appId,
    expectedTeamId: identity.teamId,
    clientId: params.clientId,
    encryptedClientSecret: encryptedClientSecret.encrypted,
    requiredScopes,
    redirectUri,
    createdAt: Date.now(),
  }
  const stored = await redis.set(
    attemptKey(state),
    JSON.stringify(attempt),
    'PX',
    SLACK_MANAGED_USERS_ATTEMPT_TTL_MS,
    'NX'
  )
  if (stored !== 'OK') throw new Error('Slack managed-user state collision')

  const authorizationUrl = new URL('https://slack.com/oauth/v2/authorize')
  authorizationUrl.searchParams.set('client_id', params.clientId)
  authorizationUrl.searchParams.set('user_scope', requiredScopes.join(','))
  authorizationUrl.searchParams.set('redirect_uri', redirectUri)
  authorizationUrl.searchParams.set('state', state)
  authorizationUrl.searchParams.set('team', identity.teamId)
  return { state, authorizationUrl: authorizationUrl.toString() }
}

export async function consumeSlackManagedUsersAttempt(
  state: string
): Promise<SlackManagedUsersAttempt | null> {
  const redis = requireRedis()
  const raw = await redis.eval(CONSUME_SCRIPT, 1, attemptKey(state))
  return parseSlackManagedUsersAttempt(raw)
}

export async function loadSlackManagedUsersAttempt(
  state: string
): Promise<SlackManagedUsersAttempt | null> {
  const redis = requireRedis()
  const raw = await redis.get(attemptKey(state))
  return parseSlackManagedUsersAttempt(raw)
}

async function parseSlackManagedUsersAttempt(
  raw: unknown
): Promise<SlackManagedUsersAttempt | null> {
  if (raw === null) return null
  if (typeof raw !== 'string') throw new Error('Slack managed-user state is malformed')
  const parsed: unknown = JSON.parse(raw)
  if (!isStoredAttempt(parsed)) throw new Error('Slack managed-user state is malformed')
  if (Date.now() - parsed.createdAt > SLACK_MANAGED_USERS_ATTEMPT_TTL_MS) return null
  const clientSecret = await decryptSecret(parsed.encryptedClientSecret)
  return {
    ...resourceScopeFields(resourceScopeFromOwner(parsed)),
    userId: parsed.userId,
    credentialGroupId: parsed.credentialGroupId,
    credentialGroupUpdatedAt: parsed.credentialGroupUpdatedAt,
    ...(parsed.workspaceId
      ? {
          slackBotCredentialId: parsed.slackBotCredentialId,
          slackBotCredentialUpdatedAt: parsed.slackBotCredentialUpdatedAt,
        }
      : {}),
    expectedAppId: parsed.expectedAppId,
    expectedTeamId: parsed.expectedTeamId,
    clientId: parsed.clientId,
    clientSecret: clientSecret.decrypted,
    redirectUri: parsed.redirectUri,
    requiredScopes: parsed.requiredScopes,
    createdAt: parsed.createdAt,
  }
}

export async function exchangeAndConfigureSlackManagedUsers(params: {
  attempt: SlackManagedUsersAttempt
  code: string
}): Promise<{
  credentialGroupId: string
  credentialGroupName: string
  slackBotCredentialId?: string
  appId: string
  teamId: string
  requiredScopes: string[]
}> {
  const grant = await exchangeSlackUserAuthorization({
    clientId: params.attempt.clientId,
    clientSecret: params.attempt.clientSecret,
    code: params.code,
    redirectUri: params.attempt.redirectUri,
  })
  if (grant.expiresIn !== undefined || grant.refreshToken) {
    await Promise.allSettled(
      [grant.accessToken, grant.refreshToken]
        .filter((token): token is string => Boolean(token))
        .map(revokeSlackToken)
    )
    throw new SlackManagedUsersError(
      'Disable token rotation in the Slack app and try again.',
      'token_rotation_enabled'
    )
  }

  try {
    if (
      grant.appId !== params.attempt.expectedAppId ||
      grant.teamId !== params.attempt.expectedTeamId
    ) {
      throw new SlackManagedUsersError(
        'Slack returned a different app or workspace than the configured App ID and workspace ID.',
        'invalid_response'
      )
    }
    if (!params.attempt.requiredScopes.every((scope) => grant.scopes.includes(scope))) {
      throw new SlackManagedUsersError(
        'Slack did not grant every permission required for managed users.',
        'invalid_response'
      )
    }
    await verifySlackUserIdentity({
      accessToken: grant.accessToken,
      expectedTeamId: grant.teamId,
      expectedUserId: grant.userId,
    })
  } finally {
    await revokeSlackToken(grant.accessToken)
  }
  const authorizationAppId = `slack:${grant.appId}:${grant.teamId}`
  const now = new Date()
  const scopeVersion = credentialGroupScopePolicyVersion(params.attempt.requiredScopes)

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`slack-managed-users:${params.attempt.credentialGroupId}`}, 0))`
    )
    const [group] = await tx
      .select()
      .from(credentialGroup)
      .where(
        and(
          eq(credentialGroup.id, params.attempt.credentialGroupId),
          resourceScopeCondition(credentialGroup, resourceScopeFromOwner(params.attempt))
        )
      )
      .limit(1)
      .for('update')
    if (!group || group.updatedAt.getTime() !== params.attempt.credentialGroupUpdatedAt) {
      throw new SlackManagedUsersError(
        'The Credential Group changed while Slack authorization was in progress. Start again.',
        'invalid_state'
      )
    }
    if (params.attempt.workspaceId) {
      if (!params.attempt.slackBotCredentialId)
        throw new SlackManagedUsersError('Workspace Slack bot is missing.', 'invalid_state')
      const [botRow] = await tx
        .select({
          id: credential.id,
          updatedAt: credential.updatedAt,
          encryptedServiceAccountKey: credential.encryptedServiceAccountKey,
        })
        .from(credential)
        .where(
          and(
            eq(credential.id, params.attempt.slackBotCredentialId),
            resourceScopeCondition(credential, resourceScopeFromOwner(params.attempt)),
            eq(credential.type, 'service_account'),
            eq(credential.providerId, SLACK_CUSTOM_BOT_PROVIDER_ID)
          )
        )
        .limit(1)
      if (
        !botRow?.encryptedServiceAccountKey ||
        botRow.updatedAt.getTime() !== params.attempt.slackBotCredentialUpdatedAt
      ) {
        throw new SlackManagedUsersError(
          'The custom bot changed while Slack authorization was in progress. Start again.',
          'invalid_state'
        )
      }
      const decrypted = await decryptSecret(botRow.encryptedServiceAccountKey)
      const botSecret = parseSlackCustomBotSecret(JSON.parse(decrypted.decrypted) as unknown)
      if (botSecret.teamId !== grant.teamId) {
        throw new SlackManagedUsersError(
          'The custom bot no longer belongs to the verified Slack workspace.',
          'invalid_state'
        )
      }
      const sanitizedBotSecret = await encryptSecret(JSON.stringify(botSecret))
      const [cleanedBot] = await tx
        .update(credential)
        .set({
          encryptedServiceAccountKey: sanitizedBotSecret.encrypted,
          authorizationAppId: null,
          managedOauthScopeVersion: null,
          updatedAt: now,
        })
        .where(eq(credential.id, botRow.id))
        .returning({ id: credential.id })
      if (!cleanedBot) throw new Error('Slack custom bot cleanup returned no row')
    }
    const currentConfiguration = await decryptCredentialGroupProviderConfiguration(
      group.encryptedProviderConfiguration
    )
    const encryptedConfiguration = await encryptCredentialGroupProviderConfiguration({
      ...currentConfiguration,
      slack: {
        slackBotCredentialId: params.attempt.slackBotCredentialId,
        clientId: params.attempt.clientId,
        clientSecret: params.attempt.clientSecret,
        appId: grant.appId,
        teamId: grant.teamId,
        scopes: [...new Set(grant.scopes)],
        verifiedAt: now.toISOString(),
      },
    })
    const existingOption = group.options.find((option) => option.provider === 'slack')
    const nextOption = {
      id: existingOption?.id ?? generateId(),
      provider: 'slack',
      label: existingOption?.label ?? 'Slack',
      slackBotCredentialId: params.attempt.slackBotCredentialId,
      authorizationAppId,
      requiredScopes: params.attempt.requiredScopes,
      scopeVersion,
      required: existingOption?.required ?? false,
      status: existingOption?.status ?? ('active' as const),
    }
    const options = existingOption
      ? group.options.map((option) => (option.id === existingOption.id ? nextOption : option))
      : [...group.options, nextOption]
    const [updated] = await tx
      .update(credentialGroup)
      .set({
        options,
        encryptedProviderConfiguration: encryptedConfiguration,
        updatedAt: now,
      })
      .where(eq(credentialGroup.id, group.id))
      .returning({ id: credentialGroup.id })
    if (!updated) throw new Error('Credential Group Slack configuration update returned no row')
    if (
      existingOption &&
      (existingOption.authorizationAppId !== authorizationAppId ||
        existingOption.scopeVersion !== scopeVersion)
    ) {
      const enrollmentIds = tx
        .select({ id: credentialGroupEnrollment.id })
        .from(credentialGroupEnrollment)
        .where(eq(credentialGroupEnrollment.credentialGroupId, group.id))
      await tx
        .update(credential)
        .set({ managedOauthStatus: 'needs_reauth', updatedAt: now })
        .where(
          and(
            eq(credential.type, 'managed_oauth'),
            inArray(credential.credentialGroupEnrollmentId, enrollmentIds),
            eq(credential.credentialGroupOptionId, existingOption.id)
          )
        )
    }
    return {
      credentialGroupId: group.id,
      credentialGroupName: group.name,
      slackBotCredentialId: params.attempt.slackBotCredentialId,
      appId: grant.appId,
      teamId: grant.teamId,
      requiredScopes: params.attempt.requiredScopes,
    }
  })
}

export async function getSlackCustomBotCredential(params: {
  workspaceId?: string | null
  organizationId?: string | null
  credentialId: string
  executor?: DbOrTx
}): Promise<{
  id: string
  name: string
  updatedAt: Date
  botToken: string
  teamId: string
  teamName?: string
} | null> {
  const executor = params.executor ?? db
  const [row] = await executor
    .select({
      id: credential.id,
      name: credential.displayName,
      updatedAt: credential.updatedAt,
      encryptedServiceAccountKey: credential.encryptedServiceAccountKey,
    })
    .from(credential)
    .where(
      and(
        resourceScopeCondition(credential, resourceScopeFromOwner(params)),
        eq(credential.type, 'service_account'),
        eq(credential.providerId, SLACK_CUSTOM_BOT_PROVIDER_ID),
        eq(credential.id, params.credentialId)
      )
    )
    .limit(1)
  if (!row) return null
  if (!row.encryptedServiceAccountKey) throw new Error('Slack custom bot secret is missing')
  const decrypted = await decryptSecret(row.encryptedServiceAccountKey)
  const secret = parseSlackCustomBotSecret(JSON.parse(decrypted.decrypted) as unknown)
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt,
    botToken: secret.botToken,
    teamId: secret.teamId,
    teamName: secret.teamName,
  }
}
