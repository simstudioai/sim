import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import type { ResourceOwner } from '@/lib/core/resource-scope'
import type { PinnedConnectionPool } from '@/lib/core/security/input-validation.server'
import type { ResolvedLiveAccount } from '@/lib/sim-search/live/accounts'
import { createCodaMcpClient, readCodaMcp, searchCodaMcp } from '@/lib/sim-search/live/coda-mcp'
import { createAdminGitLabSession } from '@/lib/sim-search/live/gitlab-admin'
import { createNativeClient } from '@/lib/sim-search/live/http'
import { createPolicyVerifier } from '@/lib/sim-search/live/policy'
import type { LiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import { livePolicyFor, loadLiveSearchPolicies } from '@/lib/sim-search/live/policy-store'
import { LIVE_SEARCH_PROVIDER_CATALOG } from '@/lib/sim-search/live/provider-catalog'
import { readNativeProvider, searchNativeProvider } from '@/lib/sim-search/live/providers'
import { searchWithinPolicy } from '@/lib/sim-search/live/scoped-search'
import { createLiveServiceSession } from '@/lib/sim-search/live/service-session'
import type { NativeDocument, NativePage, NativeSearchInput } from '@/lib/sim-search/live/types'

type Reference = Pick<
  NativeDocument,
  'id' | 'container' | 'kind' | 'revision' | 'threadId' | 'accessMetadata'
>

/** One member account's provider clients and the source boundary that bounds its results. */
export interface LiveAccountSession {
  /** The effective policy: the service source's settings in service mode, else the member's. */
  policy: LiveSearchPolicy
  /** Service verification covered a bounded subset of the source's configured users. */
  servicePartial: boolean
  search(input: NativeSearchInput): Promise<NativePage>
  /** True only when the document is inside the source boundary and the member may read it. */
  verify(document: Reference): Promise<boolean>
  read(reference: Reference, filters?: WorkspaceSearchFilters): Promise<NativeDocument>
  /** Checks a fetched document against the source settings saved now, not at session start. */
  verifyCurrent(document: NativeDocument): Promise<boolean>
}

interface OpenLiveAccountSessionInput {
  owner: ResourceOwner
  userId: string
  resolved: ResolvedLiveAccount
  policies: Record<string, unknown>
  signal: AbortSignal
  pool?: PinnedConnectionPool
}

/**
 * Opens the clients a search or read of one account needs: the member's provider client (or
 * Coda MCP client), an administrator GitLab session, and the source verifier. Search and read
 * share this so both apply exactly the same boundary.
 */
export async function openLiveAccountSession(
  input: OpenLiveAccountSessionInput
): Promise<LiveAccountSession> {
  const { owner, userId, resolved, signal } = input
  const { account } = resolved
  const provider = account.provider
  const origin =
    'origin' in resolved ? resolved.origin : LIVE_SEARCH_PROVIDER_CATALOG[provider].origin
  const client =
    account.type === 'managed_mcp'
      ? null
      : createNativeClient({ origin, accessToken: resolved.accessToken, signal, pool: input.pool })
  const admin =
    'adminSource' in resolved && client
      ? await createAdminGitLabSession({
          owner,
          userId,
          source: resolved.adminSource,
          token: resolved.accessToken,
          client,
          signal,
        })
      : undefined
  const mcp = client ? undefined : await createCodaMcpClient(owner, userId, account.id, signal)

  /** A service source replaces the member policy and verifies with its own credential. */
  const sourceBoundary = async (memberPolicy: LiveSearchPolicy) => {
    const service = await createLiveServiceSession({
      owner,
      userId,
      provider,
      policy: memberPolicy,
      member: client,
      mcp,
      signal,
      pool: input.pool,
    })
    if (service) return service
    const verifyPolicy = createPolicyVerifier(provider, memberPolicy, client, origin, mcp)
    return {
      policy: memberPolicy,
      partial: false,
      scopeSearch: undefined,
      verify: (document: Reference) => verifyPolicy(document, document.accessMetadata),
    }
  }
  const boundary = await sourceBoundary(livePolicyFor(input.policies, provider))

  return {
    policy: boundary.policy,
    servicePartial: boundary.partial,
    async search(search) {
      const scoped = boundary.scopeSearch ? boundary.scopeSearch(search) : search
      if (scoped === null) return { documents: [] }
      if (admin) return admin.search(scoped)
      return searchWithinPolicy(provider, client, scoped, (request) =>
        client ? searchNativeProvider(provider, client, request) : searchCodaMcp(mcp!, request)
      )
    },
    async verify(document) {
      if (!(await boundary.verify(document))) return false
      return !admin || admin.verify(document, document.accessMetadata)
    },
    read(reference, filters) {
      if (admin) return admin.read(reference)
      if (client) return readNativeProvider(provider, client, reference, boundary.policy, filters)
      return readCodaMcp(mcp!, reference.id)
    },
    async verifyCurrent(document) {
      const current = await sourceBoundary(
        livePolicyFor(await loadLiveSearchPolicies(owner), provider)
      )
      return current.verify(document)
    },
  }
}
