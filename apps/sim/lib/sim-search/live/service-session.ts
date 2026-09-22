import type { LiveSearchProvider } from '@/lib/api/contracts/mothership-assistant-tools'
import type { ResourceOwner } from '@/lib/core/resource-scope'
import {
  resolveConnectorAccessToken,
  resolveConnectorTokenUserId,
} from '@/lib/knowledge/connectors/access-token'
import { escapeSearchPhrase, scopeAtlassianQuery } from '@/lib/sim-search/live/atlassian'
import type { CodaMcpClient } from '@/lib/sim-search/live/coda-mcp'
import { createCodaServiceVerifier } from '@/lib/sim-search/live/coda-service'
import { createGitHubServiceVerifier } from '@/lib/sim-search/live/github-service'
import { createGoogleServiceVerifier } from '@/lib/sim-search/live/google-service'
import {
  array,
  createNativeClient,
  NativeSearchError,
  object,
  segment,
  string,
} from '@/lib/sim-search/live/http'
import { permitsResources } from '@/lib/sim-search/live/policy'
import type { LiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import { LIVE_SEARCH_PROVIDER_CATALOG } from '@/lib/sim-search/live/provider-catalog'
import { loadLiveGitHubSources, loadLiveServiceSource } from '@/lib/sim-search/live/service-sources'
import { liveSourcePolicy } from '@/lib/sim-search/live/source-policy'
import type { NativeClient, NativeDocument, NativeSearchInput } from '@/lib/sim-search/live/types'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

interface LiveServiceSession {
  policy: LiveSearchPolicy
  partial: boolean
  verify(document: Pick<NativeDocument, 'id' | 'container' | 'kind'>): Promise<boolean>
  scopeSearch?(input: NativeSearchInput): NativeSearchInput | null
}

/** Member APIs supply candidate content; this independent source credential bounds the searchable set. */
export async function createLiveServiceSession(input: {
  owner: ResourceOwner
  userId: string
  provider: LiveSearchProvider
  policy: LiveSearchPolicy
  member: NativeClient | null
  mcp?: CodaMcpClient
  signal: AbortSignal
}): Promise<LiveServiceSession | undefined> {
  const { provider, policy, member, signal } = input
  if (policy.accessMode !== 'service_account' || provider === 'gitlab') return undefined
  if (provider === 'github') {
    if (!member) throw new NativeSearchError('reconnect', 'Connect your personal GitHub account.')
    return createGitHubServiceVerifier(await loadLiveGitHubSources(input.owner), member, signal)
  }
  if (!policy.sourceId)
    throw new NativeSearchError('unavailable', 'Ask an admin to select a service account source.')
  const source = await loadLiveServiceSource(input.owner, provider, policy.sourceId)
  const meta = CONNECTOR_META_REGISTRY[provider]
  if (!meta?.mirrorsSourceAcls)
    throw new NativeSearchError(
      'unavailable',
      'This integration does not support service account search.'
    )
  const credentialUserId = await resolveConnectorTokenUserId({
    credentialId: source.credentialId,
    organizationId: source.organizationId,
    fallbackUserId: input.userId,
  })
  if (!credentialUserId)
    throw new NativeSearchError('unavailable', 'The service account credential is unavailable.')
  const token = await resolveConnectorAccessToken({
    auth: meta.auth,
    accessMode: 'admin',
    connector: source,
    userId: credentialUserId,
    requestId: 'live-source-search',
    sourceConfig: source.config,
    signal,
  })
  if (!token) throw new NativeSearchError('unavailable', 'Reconnect the service account source.')
  const sourcePolicy = liveSourcePolicy(provider, source.config)
  if (provider === 'google_drive' || provider === 'gmail' || provider === 'google_calendar') {
    if (!member) throw new NativeSearchError('reconnect', 'Connect your personal Google account.')
    return {
      policy: sourcePolicy,
      ...(await createGoogleServiceVerifier({
        provider,
        token,
        member,
        config: source.config,
        policy: sourcePolicy,
        signal,
      })),
    }
  }
  const client = createNativeClient({
    origin: LIVE_SEARCH_PROVIDER_CATALOG[provider].origin,
    accessToken: token.accessToken,
    signal,
  })
  if (provider === 'coda')
    return {
      policy: sourcePolicy,
      verify: createCodaServiceVerifier(client, source.config, input.mcp),
      partial: false,
    }
  if (provider === 'confluence') {
    const cloudId = token.cloudId
    if (
      !cloudId ||
      !token.domain ||
      !sourcePolicy.sites.includes(
        new URL(`https://${token.domain.replace(/^https:\/\//, '')}`).host.toLowerCase()
      )
    )
      throw new NativeSearchError(
        'unavailable',
        'The Confluence service account does not match the configured site.'
      )
    return {
      policy: sourcePolicy,
      partial: false,
      scopeSearch(search) {
        const contentType = string(source.config.contentType) || 'page'
        const labels = string(source.config.labelFilter)
          .split(',')
          .map((label) => label.trim())
          .filter(Boolean)
        const scope = [
          contentType === 'all'
            ? 'type IN (page, blogpost)'
            : `type = ${JSON.stringify(contentType)}`,
          ...(labels.length
            ? [`label IN (${labels.map((label) => JSON.stringify(label)).join(', ')})`]
            : []),
        ].join(' AND ')
        const query =
          search.native?.query ?? (search.query ? `text ~ ${escapeSearchPhrase(search.query)}` : '')
        return {
          ...search,
          native: { provider, ...search.native, query: scopeAtlassianQuery(query, scope) },
        }
      },
      async verify(document: Pick<NativeDocument, 'id' | 'container' | 'kind'>) {
        if (document.container !== cloudId) return false
        const row = object(
          await client.json(
            `/ex/confluence/${segment(cloudId)}/wiki/rest/api/content/${segment(document.id)}`,
            { query: { expand: 'space,metadata.labels' } }
          )
        )
        if (
          row.id !== document.id ||
          row.status !== 'current' ||
          !permitsResources(sourcePolicy, [string(object(row.space).key)])
        )
          return false
        const type = string(source.config.contentType) || 'page'
        if (type !== 'all' && row.type !== type) return false
        const labels = string(source.config.labelFilter)
          .split(',')
          .map((label) => label.trim())
          .filter(Boolean)
        const present = array(object(object(row.metadata).labels).results).map((label) =>
          string(label.name)
        )
        return !labels.length || labels.some((label) => present.includes(label))
      },
    }
  }
  throw new NativeSearchError(
    'unavailable',
    'This integration does not support service account search.'
  )
}
