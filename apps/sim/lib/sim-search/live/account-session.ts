import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import type { ResourceOwner } from '@/lib/core/resource-scope'
import { resourceScopeFromOwner } from '@/lib/core/resource-scope'
import type { PinnedConnectionPool } from '@/lib/core/security/input-validation.server'
import type { ResolvedLiveAccount } from '@/lib/sim-search/live/accounts'
import { readCodaMcp, searchCodaMcp } from '@/lib/sim-search/live/coda-mcp'
import { readFirefliesMcp, searchFirefliesMcp } from '@/lib/sim-search/live/fireflies-mcp'
import { createAdminGitLabSession } from '@/lib/sim-search/live/gitlab-admin'
import { readGranolaMcp, searchGranolaMcp } from '@/lib/sim-search/live/granola-mcp'
import {
  createNativeClient,
  NATIVE_SEARCH_REQUEST_BUDGET,
  NativeSearchError,
} from '@/lib/sim-search/live/http'
import { readHubSpotMcp, searchHubSpotMcp } from '@/lib/sim-search/live/hubspot-mcp'
import { readLucidMcp, searchLucidMcp } from '@/lib/sim-search/live/lucid-mcp'
import { createManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'
import { isManagedSearchMcpProvider } from '@/lib/sim-search/live/managed-mcp-config'
import { readNotionMcp, searchNotionMcp } from '@/lib/sim-search/live/notion-mcp'
import { createPolicyVerifier } from '@/lib/sim-search/live/policy'
import type { LiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import { livePolicyFor, loadLiveSearchPolicies } from '@/lib/sim-search/live/policy-store'
import { LIVE_SEARCH_PROVIDER_CATALOG } from '@/lib/sim-search/live/provider-catalog'
import { isSearchProviderEnabled } from '@/lib/sim-search/live/provider-rollout'
import { readNativeProvider, searchNativeProvider } from '@/lib/sim-search/live/providers'
import { searchWithinPolicy } from '@/lib/sim-search/live/scoped-search'
import { createLiveServiceSession } from '@/lib/sim-search/live/service-session'
import type { NativeDocument, NativePage, NativeSearchInput } from '@/lib/sim-search/live/types'
import { readZoomMcp, searchZoomMcp } from '@/lib/sim-search/live/zoom-mcp'

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
  /** Releases the operation-owned provider transport after all reads and checks settle. */
  close(): Promise<void>
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
  /** Native searches this session serves; each gets the budget a separate call would have. */
  searches?: number
}

/**
 * Opens the clients a search or read of one account needs: the member's provider client (or
 * managed MCP client), an administrator GitLab session, and the source verifier. Search and read
 * share this so both apply exactly the same boundary.
 */
export async function openLiveAccountSession(
  input: OpenLiveAccountSessionInput
): Promise<LiveAccountSession> {
  const { owner, userId, resolved, signal } = input
  const { account } = resolved
  const provider = account.provider
  if (!(await isSearchProviderEnabled(provider, resourceScopeFromOwner(owner))))
    throw new NativeSearchError(
      'unavailable',
      'This Search provider is not available for this organization'
    )
  const origin =
    'origin' in resolved ? resolved.origin : LIVE_SEARCH_PROVIDER_CATALOG[provider].origin
  const client =
    account.type === 'managed_mcp'
      ? null
      : createNativeClient({
          origin,
          accessToken: resolved.accessToken,
          signal,
          pool: input.pool,
          requestBudget: NATIVE_SEARCH_REQUEST_BUDGET * (input.searches ?? 1),
        })
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
  const openMcp = async () => {
    if (client) return undefined
    if (!isManagedSearchMcpProvider(provider))
      throw new NativeSearchError(
        'unavailable',
        'This provider does not support managed MCP Search.'
      )
    return createManagedSearchMcpClient(owner, userId, account.id, provider, signal, input.searches)
  }
  const memberPolicy = livePolicyFor(input.policies, provider)
  const mcp = await openMcp()
  const searchMcp = (search: NativeSearchInput) => {
    if (!mcp) throw new NativeSearchError('unavailable', 'Managed MCP connection unavailable.')
    switch (provider) {
      case 'coda':
        return searchCodaMcp(mcp, search)
      case 'fireflies':
        return searchFirefliesMcp(mcp, search)
      case 'granola':
        return searchGranolaMcp(mcp, search)
      case 'notion':
        return searchNotionMcp(mcp, search)
      case 'hubspot':
        return searchHubSpotMcp(mcp, search)
      case 'lucid':
        return searchLucidMcp(mcp, search)
      case 'zoom':
        return searchZoomMcp(mcp, search)
      default:
        throw new NativeSearchError('unavailable', 'Unsupported managed MCP provider.')
    }
  }
  const readMcp = (reference: Reference) => {
    const { id } = reference
    if (!mcp) throw new NativeSearchError('unavailable', 'Managed MCP connection unavailable.')
    switch (provider) {
      case 'coda':
        return readCodaMcp(mcp, id)
      case 'fireflies':
        return readFirefliesMcp(mcp, id)
      case 'granola':
        return readGranolaMcp(mcp, id)
      case 'notion':
        return readNotionMcp(mcp, id)
      case 'hubspot':
        return readHubSpotMcp(mcp, id)
      case 'lucid':
        return readLucidMcp(mcp, reference)
      case 'zoom':
        return readZoomMcp(mcp, id, reference.revision)
      default:
        throw new NativeSearchError('unavailable', 'Unsupported managed MCP provider.')
    }
  }

  /** A service source replaces the member policy and verifies with its own credential. */
  const sourceBoundary = async (memberPolicy: LiveSearchPolicy, fresh = false) => {
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
    const verifyPolicy = createPolicyVerifier(provider, memberPolicy, client, origin, mcp, {
      fresh,
    })
    return {
      policy: memberPolicy,
      partial: false,
      scopeSearch: undefined,
      verify: (document: Reference) => verifyPolicy(document, document.accessMetadata),
    }
  }
  const boundary = await sourceBoundary(memberPolicy).catch(async (error: unknown) => {
    await mcp?.close()
    throw error
  })

  return {
    async close() {
      await mcp?.close()
    },
    policy: boundary.policy,
    servicePartial: boundary.partial,
    async search(search) {
      const scoped = boundary.scopeSearch ? boundary.scopeSearch(search) : search
      if (scoped === null) return { documents: [] }
      if (admin) return admin.search(scoped)
      return searchWithinPolicy(provider, client, scoped, (request) =>
        client ? searchNativeProvider(provider, client, request) : searchMcp(request)
      )
    },
    async verify(document) {
      if (!(await boundary.verify(document))) return false
      return !admin || admin.verify(document, document.accessMetadata)
    },
    read(reference, filters) {
      if (admin) return admin.read(reference)
      if (client)
        return readNativeProvider(provider, client, reference, {
          policy: boundary.policy,
          filters,
          signal,
          verify: boundary.verify,
        })
      return readMcp(reference)
    },
    async verifyCurrent(document) {
      if (!(await isSearchProviderEnabled(provider, resourceScopeFromOwner(owner)))) return false
      const current = await sourceBoundary(
        livePolicyFor(await loadLiveSearchPolicies(owner), provider),
        true
      )
      const { id, container, kind } = document
      if (!(await current.verify({ id, container, kind }))) return false
      for (const dependency of document.accessDependencies ?? []) {
        signal.throwIfAborted()
        if (!(await current.verify(dependency))) return false
      }
      return true
    },
  }
}
