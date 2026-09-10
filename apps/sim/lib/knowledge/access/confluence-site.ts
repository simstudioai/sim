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
export const CONFLUENCE_READ_SOURCE_TIMEOUT_MS = 4000
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
 * Pairs are processed lazily; proofs and token reuse last only for this admission.
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
  const contentById = new Map(credentials.map((entry) => [entry.id, entry]))
  const timeout = AbortSignal.timeout(CONFLUENCE_READ_TIMEOUT_MS)
  const admissionSignal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  const sourceSignals = new Map<string, AbortSignal>()
  const bindings = new Map<string, Promise<SiteBinding>>()
  const tokens = new Map<string, Promise<string>>()
  const proofs = new Map<string, Promise<boolean>>()
  const grants = new Map<string, ConfluenceSiteReadGrant>()
  const warnedSources = new Set<string>()
  let nextPair = 0
  const pairCount = sources.length * readerCredentials.length
  const worker = async () => {
    while (
      nextPair < pairCount &&
      grants.size < MAX_KNOWLEDGE_ACCESS_CANDIDATES &&
      !admissionSignal.aborted
    ) {
      const pair = nextPair++
      const source = sources[pair % sources.length]
      const reader = readerCredentials[Math.floor(pair / sources.length)]
      if (!source.domain || source.domain.length > 255 || !reader.providerSubjectId) continue
      const content = source.contentCredentialId
        ? contentById.get(source.contentCredentialId)
        : undefined
      if (!content?.key) continue
      let signal = sourceSignals.get(source.connectorId)
      if (!signal) {
        signal = AbortSignal.any([
          admissionSignal,
          AbortSignal.timeout(CONFLUENCE_READ_SOURCE_TIMEOUT_MS),
        ])
        sourceSignals.set(source.connectorId, signal)
      }
      if (signal.aborted) continue
      try {
        const subjectToken = confluenceSubjectToken(reader.providerSubjectId)
        if (readers.get(reader.id) !== subjectToken) continue
        let bindingPromise = bindings.get(content.id)
        if (!bindingPromise) {
          bindingPromise = readSiteBinding(content.key)
          bindings.set(content.id, bindingPromise)
        }
        const binding = await withinAdmission(bindingPromise, signal)
        if (normalizeAtlassianSiteUrl(binding.domain) !== normalizeAtlassianSiteUrl(source.domain))
          continue
        signal.throwIfAborted()
        let token = tokens.get(reader.id)
        if (!token) {
          token = resolveManagedOAuthToken({
            credentialId: reader.id,
            ...resourceScopeFields(input.scope),
            expectedProviderId: 'confluence',
            requiredScopes: ['read:confluence-user'],
          }).then(({ accessToken }) => accessToken)
          tokens.set(reader.id, token)
        }
        const accessToken = await withinAdmission(token, signal)
        signal.throwIfAborted()
        const key = JSON.stringify([binding.cloudId, reader.id, subjectToken])
        let proof = proofs.get(key)
        if (!proof) {
          if (proofs.size >= MAX_KNOWLEDGE_ACCESS_CANDIDATES) continue
          proof = verifySite(binding, reader.providerSubjectId, accessToken, signal)
          proofs.set(key, proof)
        }
        if ((await withinAdmission(proof, signal)) && grants.size < MAX_KNOWLEDGE_ACCESS_CANDIDATES)
          grants.set(JSON.stringify([source.connectorId, reader.id]), {
            connectorId: source.connectorId,
            contentCredentialId: content.id,
            readerCredentialId: reader.id,
            readerSubjectToken: subjectToken,
            domain: source.domain,
            cloudId: binding.cloudId,
          })
      } catch {
        if (!warnedSources.has(source.connectorId)) {
          warnedSources.add(source.connectorId)
          logger.warn('Confluence did not confirm current Search access', {
            connectorId: source.connectorId,
          })
        }
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONFLUENCE_READ_CONCURRENCY, sources.length) }, worker)
  )
  input.signal?.throwIfAborted()
  return [...grants.values()]
}
