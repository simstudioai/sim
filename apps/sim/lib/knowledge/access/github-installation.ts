import { db } from '@sim/db'
import {
  credential,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { type ResourceScope, resourceScopeFields } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { decryptSecret } from '@/lib/core/security/encryption'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { resolveManagedOAuthToken } from '@/lib/credentials/managed-oauth'
import type { GitHubInstallationReadGrant } from '@/lib/knowledge/access/types'
import {
  assertGitHubInstallationActive,
  assertGitHubInstallationRepositoryActive,
  parseGitHubInstallationBinding,
} from '@/lib/oauth/github-installation'
import {
  GITHUB_INSTALLATION_PROVIDER_ID,
  type GitHubInstallationBinding,
} from '@/lib/oauth/github-installation-types'

const logger = createLogger('GitHubInstallationReadAccess')
export const GITHUB_READ_SOURCE_LIMIT = 100
export const GITHUB_READ_CONCURRENCY = 4
export const GITHUB_READ_TIMEOUT_MS = 8000
export const GITHUB_READ_RESPONSE_MAX_BYTES = 64 * 1024
const INSTALLATION_BINDING_MAX_BYTES = 16 * 1024

export interface GitHubReaderCredential {
  credentialId: string
  subjectToken: string
}

interface GitHubReadSource {
  connectorId: string
  contentCredentialId: string | null
  memberCredentialId: string
  subjectToken: string
  repository: string | null
  repositoryId: string | null
  branch: string | null
}

/** Token refresh may outlive its caller, but a timed-out admission must stop waiting or fetching. */
function withinAdmission<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}

function positiveId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  return typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) ? value : null
}

async function readGitHubJson(path: string, accessToken: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'error',
    cache: 'no-store',
    signal,
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error('GitHub did not confirm current repository access')
  }
  return readResponseJsonWithLimit(response, {
    maxBytes: GITHUB_READ_RESPONSE_MAX_BYTES,
    label: 'GitHub repository authorization response',
    signal,
  })
}

/** A metadata response alone does not prove Contents permission; the Git ref endpoint does. */
async function verifyRepository(
  source: GitHubReadSource,
  accountId: string,
  accessToken: string,
  signal: AbortSignal
): Promise<boolean> {
  if (
    !source.repository ||
    !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(source.repository)
  )
    return false
  if (source.repository.split('/').some((segment) => segment === '.' || segment === '..'))
    return false
  if (!positiveId(source.repositoryId)) return false
  const path = `/repos/${source.repository.split('/').map(encodeURIComponent).join('/')}`
  const repository = await readGitHubJson(path, accessToken, signal)
  if (
    !isPlainRecord(repository) ||
    positiveId(repository.id) !== source.repositoryId ||
    !isPlainRecord(repository.owner) ||
    positiveId(repository.owner.id) !== accountId
  )
    return false
  const branch = source.branch?.trim() || repository.default_branch
  if (typeof branch !== 'string' || !branch || branch.length > 1024) return false
  if (branch.split('/').some((segment) => !segment || segment === '.' || segment === '..'))
    return false
  const reference = await readGitHubJson(
    `${path}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`,
    accessToken,
    signal
  )
  return (
    isPlainRecord(reference) &&
    reference.ref === `refs/heads/${branch}` &&
    isPlainRecord(reference.object) &&
    reference.object.type === 'commit' &&
    typeof reference.object.sha === 'string' &&
    /^[a-f0-9]{40,64}$/.test(reference.object.sha)
  )
}

/**
 * Proves current reader access before any installation-backed indexed content is selected.
 * The caller supplies credentials already bound to the verified current member. All positive
 * evidence and token reuse are local to this admission; failures grant nothing for that source.
 */
export async function resolveGitHubInstallationReadGrants(input: {
  scope: ResourceScope
  readers: readonly GitHubReaderCredential[]
  knowledgeBaseIds?: readonly string[]
  signal?: AbortSignal
}): Promise<GitHubInstallationReadGrant[]> {
  if (
    !input.readers.length ||
    input.readers.length > GITHUB_READ_SOURCE_LIMIT ||
    (input.knowledgeBaseIds &&
      (input.knowledgeBaseIds.length === 0 ||
        input.knowledgeBaseIds.length > GITHUB_READ_SOURCE_LIMIT))
  )
    return []
  const readers = new Map(input.readers.map((reader) => [reader.credentialId, reader.subjectToken]))
  const sources: GitHubReadSource[] = await db
    .select({
      connectorId: knowledgeConnector.id,
      contentCredentialId: knowledgeConnector.credentialId,
      memberCredentialId: knowledgeConnectorMember.credentialId,
      subjectToken: knowledgeConnectorMember.subjectToken,
      repository: sql<string | null>`left(${knowledgeConnector.sourceConfig}->>'repository', 202)`,
      repositoryId: sql<
        string | null
      >`left(${knowledgeConnector.sourceConfig}->>'githubRepositoryId', 21)`,
      branch: sql<string | null>`left(${knowledgeConnector.sourceConfig}->>'branch', 1025)`,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .innerJoin(
      knowledgeConnectorMember,
      eq(knowledgeConnectorMember.connectorId, knowledgeConnector.id)
    )
    .where(
      and(
        resourceScopeCondition(knowledgeBase, input.scope),
        input.knowledgeBaseIds ? inArray(knowledgeBase.id, [...input.knowledgeBaseIds]) : undefined,
        isNull(knowledgeBase.deletedAt),
        eq(knowledgeConnector.connectorType, 'github'),
        eq(knowledgeConnector.accessMode, 'members'),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt),
        eq(knowledgeConnectorMember.status, 'active'),
        inArray(knowledgeConnectorMember.credentialId, [...readers.keys()]),
        sql`${knowledgeConnector.sourceConfig}::jsonb ? 'githubRepositoryId'`
      )
    )
    .orderBy(asc(knowledgeConnector.id), asc(knowledgeConnectorMember.id))
    .limit(GITHUB_READ_SOURCE_LIMIT + 1)
  if (sources.length > GITHUB_READ_SOURCE_LIMIT || !sources.length) return []
  const contentCredentialIds = [
    ...new Set(
      sources.flatMap((source) => (source.contentCredentialId ? [source.contentCredentialId] : []))
    ),
  ]
  if (!contentCredentialIds.length) return []
  const credentials = await db
    .select({
      id: credential.id,
      key: credential.encryptedServiceAccountKey,
      installationId: credential.providerSubjectId,
      accountId: credential.providerTenantId,
    })
    .from(credential)
    .where(
      and(
        inArray(credential.id, contentCredentialIds),
        resourceScopeCondition(credential, input.scope),
        eq(credential.type, 'service_account'),
        eq(credential.providerId, GITHUB_INSTALLATION_PROVIDER_ID),
        isNull(credential.revokedAt),
        sql`octet_length(${credential.encryptedServiceAccountKey}) <= ${INSTALLATION_BINDING_MAX_BYTES}`
      )
    )
    .limit(GITHUB_READ_SOURCE_LIMIT)
  const contentById = new Map(credentials.map((entry) => [entry.id, entry]))
  const timeout = AbortSignal.timeout(GITHUB_READ_TIMEOUT_MS)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  const installations = new Map<string, Promise<GitHubInstallationBinding>>()
  const tokens = new Map<string, Promise<string>>()
  const proofs = new Map<string, Promise<boolean>>()
  const grants = new Map<string, GitHubInstallationReadGrant>()
  for (
    let offset = 0;
    offset < sources.length && !signal.aborted;
    offset += GITHUB_READ_CONCURRENCY
  ) {
    await Promise.all(
      sources.slice(offset, offset + GITHUB_READ_CONCURRENCY).map(async (source) => {
        if (readers.get(source.memberCredentialId) !== source.subjectToken) return
        const content = source.contentCredentialId
          ? contentById.get(source.contentCredentialId)
          : undefined
        if (!content?.key || !source.repositoryId) return
        try {
          let installation = installations.get(content.id)
          if (!installation) {
            installation = (async () => {
              const { decrypted } = await decryptSecret(content.key!)
              const binding = parseGitHubInstallationBinding(JSON.parse(decrypted))
              if (
                binding.installationId !== content.installationId ||
                binding.accountId !== content.accountId
              )
                throw new Error('GitHub installation credential identity mismatch')
              await assertGitHubInstallationActive(binding, { signal })
              return binding
            })()
            installations.set(content.id, installation)
          }
          const binding = await installation
          signal.throwIfAborted()
          let token = tokens.get(source.memberCredentialId)
          if (!token) {
            token = resolveManagedOAuthToken({
              credentialId: source.memberCredentialId,
              ...resourceScopeFields(input.scope),
              expectedProviderId: 'github-repositories',
              requiredScopes: [],
            }).then(({ accessToken }) => {
              if (!accessToken.startsWith('ghu_'))
                throw new Error('A GitHub App user token is required')
              return accessToken
            })
            tokens.set(source.memberCredentialId, token)
          }
          const accessToken = await withinAdmission(token, signal)
          signal.throwIfAborted()
          const key = JSON.stringify([
            content.id,
            source.memberCredentialId,
            source.repositoryId,
            source.repository,
            source.branch,
          ])
          let proof = proofs.get(key)
          if (!proof) {
            proof = (async () => {
              if (!source.repository) return false
              await assertGitHubInstallationRepositoryActive(binding, source.repository, { signal })
              return verifyRepository(source, binding.accountId, accessToken, signal)
            })()
            proofs.set(key, proof)
          }
          if (await proof)
            grants.set(source.connectorId, {
              connectorId: source.connectorId,
              contentCredentialId: content.id,
              readerCredentialId: source.memberCredentialId,
              readerSubjectToken: source.subjectToken,
              repositoryId: source.repositoryId,
            })
        } catch {
          logger.warn('GitHub did not confirm current Search access', {
            connectorId: source.connectorId,
          })
        }
      })
    )
  }
  /** Once admission expires, none of its partial proofs may authorize a later content query. */
  return signal.aborted ? [] : [...grants.values()]
}
