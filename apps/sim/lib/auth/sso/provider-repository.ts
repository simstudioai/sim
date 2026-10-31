import {
  DEFAULT_MAX_SAML_METADATA_SIZE,
  DigestAlgorithm,
  deriveSAMLServiceProviderPolicy,
  SignatureAlgorithm,
  type sso,
} from '@better-auth/sso'
import { account, db, ssoProvider, user } from '@sim/db'
import { createLogger } from '@sim/logger'
import { toStringOrNull } from '@sim/utils/coerce'
import { generateId } from '@sim/utils/id'
import { filterUndefined, omit, sortObjectKeysDeep, toRecord } from '@sim/utils/object'
import { APIError } from 'better-auth/api'
import { and, count, eq } from 'drizzle-orm'
import type { auth } from '@/lib/auth'
import { normalizeIssuer } from '@/lib/auth/sso/issuer'
import type { SsoProviderConfig } from '@/lib/auth/sso/provider-adapter'
import { lockSsoProvider } from '@/lib/auth/sso/provider-lock'
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('SsoProviderRepository')
const BUILT_IN_PROVIDER_IDS = [
  'credential',
  'email-otp',
  'magic-link',
  'phone-number',
  'anonymous',
  'siwe',
] as const
const OIDC_IDENTITY_FIELDS = [
  'authorizationEndpoint',
  'clientId',
  'discoveryEndpoint',
  'jwksEndpoint',
  'tokenEndpoint',
  'userInfoEndpoint',
] as const
/**
 * `callbackUrl` stays an identity field: Sim writes the ACS URL there and into the SP metadata
 * `Location`, which decides where the IdP posts assertions and which Recipient Better Auth
 * accepts. Better Auth 1.7 itself treats SP ACS URLs as part of the identity boundary.
 */
const SAML_IDENTITY_FIELDS = ['audience', 'callbackUrl', 'entryPoint', 'identifierFormat'] as const
const SAML_IDP_IDENTITY_FIELDS = ['metadata', 'entityID', 'singleSignOnService'] as const
const SAML_SP_IDENTITY_FIELDS = ['metadata', 'entityID'] as const
const WANT_ASSERTIONS_SIGNED_ATTRIBUTE = /\sWantAssertionsSigned\s*=\s*(["'])[^"']*\1/

interface RepositoryConfiguration {
  reservedProviderIds: readonly string[]
}

/** Distinguishes an omitted UserInfo endpoint from an intentional removal. */
interface SsoProviderUpdateOptions {
  clearUserInfoEndpoint?: boolean
}

function changedFields(
  current: Record<string, unknown>,
  updated: Record<string, unknown>,
  fields: readonly string[]
) {
  return fields.some(
    (field) =>
      JSON.stringify(sortObjectKeysDeep(current[field])) !==
      JSON.stringify(sortObjectKeysDeep(updated[field]))
  )
}

function storedConfiguration(value: string | null, protocol: string): Record<string, unknown> {
  if (!value)
    throw new APIError('BAD_REQUEST', {
      message: `Cannot update ${protocol} config for a provider that doesn't have ${protocol} configured`,
    })
  try {
    return toRecord(JSON.parse(value))
  } catch {
    throw new APIError('BAD_REQUEST', {
      message: `Cannot update invalid ${protocol} configuration`,
    })
  }
}

function normalizeAlgorithm(value: string, algorithms: Record<string, string>, signature: boolean) {
  const suffix = value.toLowerCase()
  return (
    Object.values(algorithms).find(
      (uri) =>
        uri === value ||
        uri.split('#')[1] === suffix ||
        (signature && uri.split('#')[1] === `rsa-${suffix}`)
    ) ?? value
  )
}

function samlMetadata(value: unknown): Record<string, unknown> {
  return typeof value === 'string' ? { metadata: value } : toRecord(value)
}

/**
 * The IdP authority Better Auth signs users in against: the metadata document when present,
 * otherwise the declared entity ID, which Better Auth 1.6 defaulted to the configured issuer.
 */
function samlIdentityProvider(config: Record<string, unknown>): Record<string, unknown> {
  const idp = samlMetadata(config.idpMetadata)
  return idp.metadata
    ? { metadata: idp.metadata, singleSignOnService: idp.singleSignOnService }
    : { entityID: idp.entityID || config.issuer, singleSignOnService: idp.singleSignOnService }
}

/** The assertion-signing policy is a security setting, not part of who the SP is. */
function samlServiceProvider(config: Record<string, unknown>): Record<string, unknown> {
  const sp = samlMetadata(config.spMetadata)
  return {
    ...sp,
    metadata:
      typeof sp.metadata === 'string'
        ? sp.metadata.replace(WANT_ASSERTIONS_SIGNED_ATTRIBUTE, '')
        : sp.metadata,
  }
}

/**
 * Rejects configurations Better Auth 1.7 refuses at sign-in, so a save fails instead of the next
 * login: a manual IdP must name its entity ID, SP metadata must be usable, and it must not
 * advertise weaker assertion signing than `wantAssertionsSigned` requires.
 */
function assertSamlSignInPolicy(config: Record<string, unknown>) {
  const idp = toRecord(config.idpMetadata)
  if (!idp.metadata && !idp.entityID)
    throw new APIError('BAD_REQUEST', {
      message: 'SAML configuration requires IdP metadata or an IdP entity ID',
    })
  const wantAssertionsSigned = config.wantAssertionsSigned === true
  const metadata = toStringOrNull(toRecord(config.spMetadata).metadata) ?? undefined
  const policy = deriveSAMLServiceProviderPolicy({
    spMetadata: { metadata },
    wantAssertionsSigned,
  })
  if (wantAssertionsSigned && !policy.wantAssertionsSigned)
    throw new APIError('BAD_REQUEST', {
      message: 'SAML service provider metadata must require signed assertions',
    })
}

/** Persists authorized provider changes through the caller's database transaction. */
export function createSsoProviderRepository(
  userId: string,
  organizationId: string,
  plugin: ReturnType<typeof sso>,
  configuration: RepositoryConfiguration,
  executor: DbOrTx = db
) {
  const validateConfig = (body: SsoProviderConfig) => {
    const config = body.samlConfig
    if (!config) return
    const maximum = plugin.options?.saml?.maxMetadataSize ?? DEFAULT_MAX_SAML_METADATA_SIZE
    if (
      config.idpMetadata?.metadata &&
      new TextEncoder().encode(config.idpMetadata.metadata).length > maximum
    )
      throw new APIError('BAD_REQUEST', {
        message: `IdP metadata exceeds maximum allowed size (${maximum} bytes)`,
      })
    const options = plugin.options?.saml?.algorithms
    for (const [value, algorithms, allowed, deprecated, signature] of [
      [
        config.signatureAlgorithm,
        SignatureAlgorithm,
        options?.allowedSignatureAlgorithms,
        SignatureAlgorithm.RSA_SHA1,
        true,
      ],
      [
        config.digestAlgorithm,
        DigestAlgorithm,
        options?.allowedDigestAlgorithms,
        DigestAlgorithm.SHA1,
        false,
      ],
    ] as const) {
      if (!value) continue
      const normalized = normalizeAlgorithm(value, algorithms, signature)
      if (
        allowed
          ? !allowed.some(
              (entry) => normalizeAlgorithm(entry, algorithms, signature) === normalized
            )
          : !Object.values(algorithms).some((entry) => entry === normalized)
      )
        throw new APIError('BAD_REQUEST', { message: 'SAML algorithm is not permitted' })
      if (!allowed && normalized === deprecated) {
        if (options?.onDeprecated === 'reject')
          throw new APIError('BAD_REQUEST', { message: 'SAML algorithm is deprecated' })
        if (options?.onDeprecated !== 'allow')
          logger.warn('SSO configuration uses a deprecated SAML algorithm')
      }
    }
  }

  return {
    async register(input: SsoProviderConfig) {
      // Keep the parser's output so its defaults apply; its declared output type is untyped.
      const body: SsoProviderConfig = {
        ...input,
        ...plugin.endpoints.registerSSOProvider.options.body.parse(input),
      }
      if (body.organizationId !== organizationId)
        throw new APIError('BAD_REQUEST', {
          message: 'Provider organization does not match its authorized scope',
        })
      validateConfig(body)
      if (body.samlConfig) assertSamlSignInPolicy({ ...body.samlConfig, issuer: body.issuer })
      const reserved = new Set<string>([
        ...BUILT_IN_PROVIDER_IDS,
        ...configuration.reservedProviderIds,
        ...(plugin.options?.defaultSSO?.map((provider) => provider.providerId) ?? []),
      ])
      if (reserved.has(body.providerId))
        throw new APIError('UNPROCESSABLE_ENTITY', {
          message: 'This providerId is reserved and cannot be used for an SSO provider',
        })
      return executor.transaction(async (tx) => {
        await lockSsoProvider(tx, body.providerId)
        const [subject] = await tx
          .select()
          .from(user)
          .where(eq(user.id, userId))
          .for('update')
          .limit(1)
        if (!subject) throw new APIError('NOT_FOUND', { message: 'User not found' })
        const configuredLimit = plugin.options?.providersLimit
        const limit =
          typeof configuredLimit === 'function'
            ? await configuredLimit(subject)
            : (configuredLimit ?? 10)
        const [total] = await tx
          .select({ value: count() })
          .from(ssoProvider)
          .where(eq(ssoProvider.userId, userId))
        if (!limit || total.value >= limit)
          throw new APIError('FORBIDDEN', {
            message: !limit
              ? 'SSO provider registration is disabled'
              : 'You have reached the maximum number of SSO providers',
          })
        const id = generateId()
        await tx.insert(ssoProvider).values({
          id,
          userId,
          providerId: body.providerId,
          organizationId,
          issuer: body.issuer,
          domain: body.domain,
          domainVerified: false,
          oidcConfig: body.oidcConfig
            ? JSON.stringify({
                ...body.oidcConfig,
                issuer: body.issuer,
                overrideUserInfo:
                  body.overrideUserInfo ?? plugin.options?.defaultOverrideUserInfo ?? false,
              })
            : null,
          samlConfig: body.samlConfig
            ? JSON.stringify({ ...body.samlConfig, issuer: body.issuer })
            : null,
        })
        return { id, providerId: body.providerId }
      })
    },
    async update(
      input: NonNullable<Parameters<typeof auth.api.updateSSOProvider>[0]>['body'],
      options: SsoProviderUpdateOptions = {}
    ) {
      const body = plugin.endpoints.updateSSOProvider.options.body.parse(input)
      return executor.transaction(async (tx) => {
        await lockSsoProvider(tx, body.providerId)
        const [existing] = await tx
          .select()
          .from(ssoProvider)
          .where(
            and(
              eq(ssoProvider.providerId, body.providerId),
              eq(ssoProvider.organizationId, organizationId)
            )
          )
          .for('update')
          .limit(1)
        if (!existing) throw new APIError('NOT_FOUND', { message: 'Provider not found' })
        const issuer = body.issuer ?? existing.issuer
        const changes: Partial<typeof ssoProvider.$inferInsert> = {
          ...(body.issuer === undefined ? {} : { issuer: body.issuer }),
          ...(body.domain === undefined ? {} : { domain: body.domain }),
          ...(body.domain !== undefined && body.domain !== existing.domain
            ? { domainVerified: false }
            : {}),
        }
        let identityChanged = normalizeIssuer(issuer) !== normalizeIssuer(existing.issuer)
        for (const protocol of ['oidc', 'saml'] as const) {
          const key = protocol === 'oidc' ? 'oidcConfig' : 'samlConfig'
          const config = body[key]
          if (!config && !(protocol === 'oidc' && options.clearUserInfoEndpoint)) continue
          validateConfig({
            providerId: body.providerId,
            issuer,
            domain: body.domain ?? existing.domain,
            [key]: config,
          })
          const current = storedConfiguration(existing[key], protocol.toUpperCase())
          const updated: Record<string, unknown> = {
            ...current,
            ...filterUndefined(config ?? {}),
            issuer,
          }
          if (protocol === 'oidc') {
            updated.pkce = toRecord(config).pkce ?? current.pkce ?? true
            if (options.clearUserInfoEndpoint) updated.userInfoEndpoint = undefined
            identityChanged ||= changedFields(current, updated, OIDC_IDENTITY_FIELDS)
          } else {
            const incomingSp = body.samlConfig?.spMetadata
            if (current.spMetadata !== undefined || incomingSp !== undefined)
              updated.spMetadata = {
                ...samlMetadata(current.spMetadata),
                ...filterUndefined(incomingSp ?? {}),
              }
            const currentIdp = samlMetadata(current.idpMetadata)
            const incomingIdp = body.samlConfig?.idpMetadata
            if (incomingIdp) {
              /**
               * The caller states the IdP authority in full, so omitting `metadata` clears a stored
               * document. An entity ID an operator set apart from the issuer survives a re-save.
               */
              const idp: Record<string, unknown> = {
                ...omit(currentIdp, ['metadata', 'entityID']),
                ...filterUndefined(incomingIdp),
              }
              const currentIssuer = toStringOrNull(current.issuer) ?? existing.issuer
              if (!idp.metadata && currentIdp.entityID && currentIdp.entityID !== currentIssuer)
                idp.entityID = currentIdp.entityID
              updated.idpMetadata = idp
            } else if (current.idpMetadata !== undefined) {
              updated.idpMetadata = currentIdp
            }
            assertSamlSignInPolicy(updated)
            identityChanged ||=
              changedFields(current, updated, SAML_IDENTITY_FIELDS) ||
              changedFields(
                samlIdentityProvider(current),
                samlIdentityProvider(updated),
                SAML_IDP_IDENTITY_FIELDS
              ) ||
              changedFields(
                samlServiceProvider(current),
                samlServiceProvider(updated),
                SAML_SP_IDENTITY_FIELDS
              )
          }
          changes[key] = JSON.stringify(updated)
        }
        if (identityChanged) {
          const [linked] = await tx
            .select({ id: account.id })
            .from(account)
            .where(eq(account.providerId, body.providerId))
            .limit(1)
          if (linked)
            throw new APIError('CONFLICT', {
              message: 'Cannot change SSO provider identity fields while linked accounts exist',
            })
        }
        await tx
          .update(ssoProvider)
          .set(changes)
          .where(
            and(eq(ssoProvider.id, existing.id), eq(ssoProvider.organizationId, organizationId))
          )
        return { providerId: existing.providerId }
      })
    },
  }
}
