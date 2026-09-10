import { db } from '@sim/db'
import { credential, knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { normalizeAtlassianSiteUrl } from '@/lib/atlassian/discovery'
import { type ResourceScope, resourceScopeFields } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { decryptSecret } from '@/lib/core/security/encryption'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { resolveManagedOAuthToken } from '@/lib/credentials/managed-oauth'
import { confluenceSubjectToken } from '@/lib/knowledge/access/confluence-permissions'
import {
  type ConfluenceSiteReadGrant,
  MAX_KNOWLEDGE_ACCESS_CANDIDATES,
} from '@/lib/knowledge/access/types'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  ATLASSIAN_SERVICE_ACCOUNT_SECRET_TYPE,
} from '@/lib/oauth/types'

const logger = createLogger('ConfluenceSiteReadAccess')
export const CONFLUENCE_READ_CONCURRENCY = 4
export const CONFLUENCE_READ_TIMEOUT_MS = 8000
export const CONFLUENCE_READ_ATTEMPT_TIMEOUT_MS = 4000
export const CONFLUENCE_READ_CREDENTIAL_ALTERNATIVES = 4
const CONFLUENCE_READ_ALTERNATIVE_CONCURRENCY = 2
export const CONFLUENCE_READ_RESPONSE_MAX_BYTES = 64 * 1024
const SITE_BINDING_MAX_BYTES = 32 * 1024

export interface ConfluenceReaderCredential {
  credentialId: string
  subjectToken: string
}

interface ConfluenceReadSource {
  connectorId: string
  contentCredentialId: string | null
  domain: string | null
}

interface SiteBinding {
  cloudId: string
  domain: string
}

interface BoundConfluenceSource {
  connectorId: string
  contentCredentialId: string
  domain: string
  cloudId: string
}

interface ConfluenceReaderIdentity {
  accountId: string
  subjectToken: string
  credentialIds: string[]
}

interface ConfirmedConfluenceReader {
  credentialId: string
  subjectToken: string
}

/** A pending token refresh must not hold the caller after its authorization deadline. */
function withinAdmission<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}

async function readSiteBinding(key: string): Promise<SiteBinding> {
  const { decrypted } = await decryptSecret(key)
  const value: unknown = JSON.parse(decrypted)
  if (
    !isPlainRecord(value) ||
    value.type !== ATLASSIAN_SERVICE_ACCOUNT_SECRET_TYPE ||
    typeof value.cloudId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(value.cloudId) ||
    typeof value.domain !== 'string' ||
    value.domain.length > 255
  )
    throw new Error('Confluence site binding is invalid')
  return { cloudId: value.cloudId, domain: value.domain }
}

/** Space grants do not prove that the reader still has Confluence's site-level Can use permission. */
async function verifySite(
  binding: SiteBinding,
  accountId: string,
  accessToken: string,
  signal: AbortSignal
): Promise<boolean> {
  signal.throwIfAborted()
  const response = await fetch(
    `https://api.atlassian.com/ex/confluence/${binding.cloudId}/wiki/rest/api/user/current`,
    {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal,
    }
  )
  if (!response.ok) {
    await response.body?.cancel()
    return false
  }
  const profile = await readResponseJsonWithLimit<unknown>(response, {
    maxBytes: CONFLUENCE_READ_RESPONSE_MAX_BYTES,
    label: 'Confluence site authorization response',
    signal,
  })
  return isPlainRecord(profile) && profile.accountId === accountId && profile.type === 'known'
}

/**
 * Checks only candidate central sources with credentials already bound to the current reader.
 * Site identity comes from the scoped indexing credential, but its token never authenticates
 * a reader. Sources, readers, provider proofs, and returned grants each have a 400-row cap.
 * Sources share proofs by site and Atlassian subject, with bounded concurrent credential
 * alternatives. A subject tries at most four credentials; an admission issues at most 400
 * site requests. Additional site/subject combinations fail closed when those budgets or the
 * deadline are exhausted. Proofs and token reuse last only for this admission.
 */
export async function resolveConfluenceSiteReadGrants(input: {
  scope: ResourceScope
  readers: readonly ConfluenceReaderCredential[]
  connectorIds: readonly string[]
  knowledgeBaseIds?: readonly string[]
  signal?: AbortSignal
}): Promise<ConfluenceSiteReadGrant[]> {
  input.signal?.throwIfAborted()
  if (input.connectorIds.length > MAX_KNOWLEDGE_ACCESS_CANDIDATES)
    throw new Error('Knowledge access candidates must be authorized in bounded pages')
  if (!input.readers.length || !input.connectorIds.length || input.knowledgeBaseIds?.length === 0)
    return []
  const readers = new Map(
    input.readers
      .slice(0, MAX_KNOWLEDGE_ACCESS_CANDIDATES)
      .map((reader) => [reader.credentialId, reader.subjectToken])
  )
  const sources: ConfluenceReadSource[] = await db
    .select({
      connectorId: knowledgeConnector.id,
      contentCredentialId: knowledgeConnector.credentialId,
      domain: sql<string | null>`left(${knowledgeConnector.sourceConfig}->>'domain', 256)`,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .where(
      and(
        resourceScopeCondition(knowledgeBase, input.scope),
        inArray(knowledgeConnector.id, [...new Set(input.connectorIds)]),
        input.knowledgeBaseIds ? inArray(knowledgeBase.id, [...input.knowledgeBaseIds]) : undefined,
        isNull(knowledgeBase.deletedAt),
        eq(knowledgeConnector.connectorType, 'confluence'),
        eq(knowledgeConnector.accessMode, 'admin'),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt)
      )
    )
    .orderBy(asc(knowledgeConnector.id))
    .limit(MAX_KNOWLEDGE_ACCESS_CANDIDATES)
  if (!sources.length) return []
  const readerCredentials = await db
    .select({ id: credential.id, providerSubjectId: credential.providerSubjectId })
    .from(credential)
    .where(
      and(
        resourceScopeCondition(credential, input.scope),
        inArray(credential.id, [...readers.keys()]),
        eq(credential.type, 'managed_oauth'),
        eq(credential.providerId, 'confluence'),
        eq(credential.managedOauthStatus, 'active'),
        isNull(credential.revokedAt)
      )
    )
    .orderBy(asc(credential.id))
    .limit(MAX_KNOWLEDGE_ACCESS_CANDIDATES)
  if (!readerCredentials.length) return []
  const contentCredentialIds = [
    ...new Set(
      sources.flatMap((source) => (source.contentCredentialId ? [source.contentCredentialId] : []))
    ),
  ]
  if (!contentCredentialIds.length) return []
  const credentials = await db
    .select({ id: credential.id, key: credential.encryptedServiceAccountKey })
    .from(credential)
    .where(
      and(
        inArray(credential.id, contentCredentialIds),
        resourceScopeCondition(credential, input.scope),
        eq(credential.type, 'service_account'),
        eq(credential.providerId, ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID),
        isNull(credential.revokedAt),
        sql`octet_length(${credential.encryptedServiceAccountKey}) <= ${SITE_BINDING_MAX_BYTES}`
      )
    )
    .limit(MAX_KNOWLEDGE_ACCESS_CANDIDATES)
  const timeout = AbortSignal.timeout(CONFLUENCE_READ_TIMEOUT_MS)
  const admissionSignal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  const bindings = new Map<string, SiteBinding>()
  for (const content of credentials) {
    if (!content.key || admissionSignal.aborted) continue
    try {
      bindings.set(content.id, await withinAdmission(readSiteBinding(content.key), admissionSignal))
    } catch {
      logger.warn('Confluence Search site binding is unavailable', { credentialId: content.id })
    }
  }
  const boundSources: BoundConfluenceSource[] = []
  const sites = new Map<string, SiteBinding>()
  for (const source of sources) {
    if (!source.contentCredentialId || !source.domain || source.domain.length > 255) continue
    const binding = bindings.get(source.contentCredentialId)
    if (
      !binding ||
      normalizeAtlassianSiteUrl(binding.domain) !== normalizeAtlassianSiteUrl(source.domain)
    )
      continue
    sites.set(binding.cloudId, binding)
    boundSources.push({
      connectorId: source.connectorId,
      contentCredentialId: source.contentCredentialId,
      domain: source.domain,
      cloudId: binding.cloudId,
    })
  }
  const identities = new Map<string, ConfluenceReaderIdentity>()
  for (const reader of readerCredentials) {
    if (!reader.providerSubjectId) continue
    try {
      const subjectToken = confluenceSubjectToken(reader.providerSubjectId)
      if (readers.get(reader.id) !== subjectToken) continue
      let identity = identities.get(subjectToken)
      if (!identity) {
        identity = { accountId: reader.providerSubjectId, subjectToken, credentialIds: [] }
        identities.set(subjectToken, identity)
      }
      if (identity.credentialIds.length < CONFLUENCE_READ_CREDENTIAL_ALTERNATIVES)
        identity.credentialIds.push(reader.id)
    } catch {
      logger.warn('Confluence Search reader identity is unavailable', { credentialId: reader.id })
    }
  }
  const siteList = [...sites.values()]
  const identityList = [...identities.values()]
  const proofCount = Math.min(
    MAX_KNOWLEDGE_ACCESS_CANDIDATES,
    siteList.length * identityList.length
  )
  const tokens = new Map<string, Promise<string>>()
  const confirmed = new Map<string, ConfirmedConfluenceReader[]>()
  let requests = 0
  let nextProof = 0
  const attempt = async (
    binding: SiteBinding,
    identity: ConfluenceReaderIdentity,
    credentialId: string,
    cancellation: AbortSignal
  ): Promise<ConfirmedConfluenceReader> => {
    const signal = AbortSignal.any([
      admissionSignal,
      cancellation,
      AbortSignal.timeout(CONFLUENCE_READ_ATTEMPT_TIMEOUT_MS),
    ])
    signal.throwIfAborted()
    let token = tokens.get(credentialId)
    if (!token) {
      const tokenSignal = AbortSignal.any([
        admissionSignal,
        AbortSignal.timeout(CONFLUENCE_READ_ATTEMPT_TIMEOUT_MS),
      ])
      token = withinAdmission(
        resolveManagedOAuthToken({
          credentialId,
          ...resourceScopeFields(input.scope),
          expectedProviderId: 'confluence',
          requiredScopes: ['read:confluence-user'],
        }).then(({ accessToken }) => accessToken),
        tokenSignal
      )
      tokens.set(credentialId, token)
    }
    const accessToken = await withinAdmission(token, signal)
    signal.throwIfAborted()
    if (requests >= MAX_KNOWLEDGE_ACCESS_CANDIDATES)
      throw new Error('Confluence read verification budget exhausted')
    requests += 1
    if (
      !(await withinAdmission(verifySite(binding, identity.accountId, accessToken, signal), signal))
    )
      throw new Error('Confluence did not confirm current site access')
    return { credentialId, subjectToken: identity.subjectToken }
  }
  const verifyIdentity = async (binding: SiteBinding, identity: ConfluenceReaderIdentity) => {
    for (
      let offset = 0;
      offset < identity.credentialIds.length && !admissionSignal.aborted;
      offset += CONFLUENCE_READ_ALTERNATIVE_CONCURRENCY
    ) {
      const cancellation = new AbortController()
      try {
        return await Promise.any(
          identity.credentialIds
            .slice(offset, offset + CONFLUENCE_READ_ALTERNATIVE_CONCURRENCY)
            .map((credentialId) => attempt(binding, identity, credentialId, cancellation.signal))
        )
      } catch {
        if (requests >= MAX_KNOWLEDGE_ACCESS_CANDIDATES) return undefined
      } finally {
        cancellation.abort()
      }
    }
    return undefined
  }
  const worker = async () => {
    while (nextProof < proofCount && !admissionSignal.aborted) {
      const index = nextProof++
      const siteIndex = index % siteList.length
      /** Rotate subjects across sites before revisiting either dimension under the proof budget. */
      const identityIndex = (Math.floor(index / siteList.length) + siteIndex) % identityList.length
      const binding = siteList[siteIndex]
      const reader = await verifyIdentity(binding, identityList[identityIndex])
      if (reader) {
        const siteReaders = confirmed.get(binding.cloudId) ?? []
        siteReaders.push(reader)
        confirmed.set(binding.cloudId, siteReaders)
      }
    }
  }
  await Promise.all(
    Array.from(
      {
        length: Math.min(
          proofCount,
          CONFLUENCE_READ_CONCURRENCY / CONFLUENCE_READ_ALTERNATIVE_CONCURRENCY
        ),
      },
      worker
    )
  )
  input.signal?.throwIfAborted()
  const grants: ConfluenceSiteReadGrant[] = []
  for (
    let round = 0;
    round < identityList.length && grants.length < MAX_KNOWLEDGE_ACCESS_CANDIDATES;
    round++
  ) {
    for (const source of boundSources) {
      const reader = confirmed.get(source.cloudId)?.[round]
      if (!reader) continue
      grants.push({
        ...source,
        readerCredentialId: reader.credentialId,
        readerSubjectToken: reader.subjectToken,
      })
      if (grants.length === MAX_KNOWLEDGE_ACCESS_CANDIDATES) break
    }
  }
  return grants
}
