import type { LiveSearchProvider } from '@/lib/api/contracts/mothership-assistant-tools'
import type { CodaMcpClient } from '@/lib/sim-search/live/coda-mcp'
import { parseCodaResourceUri } from '@/lib/sim-search/live/coda-uri'
import { array, NativeSearchError, object, segment, string } from '@/lib/sim-search/live/http'
import { type LiveSearchPolicy, requiresScopedRetrieval } from '@/lib/sim-search/live/policy-schema'
import type { NativeClient, NativeDocument } from '@/lib/sim-search/live/types'

type Reference = Pick<NativeDocument, 'id' | 'container' | 'kind'>
type PolicyVerifier = (
  document: Reference,
  providerMetadata?: Record<string, unknown>
) => Promise<boolean>

export function permitsResources(policy: LiveSearchPolicy, resources: readonly string[]) {
  if (resources.some((id) => policy.excluded.includes(id))) return false
  return policy.mode === 'all' || resources.some((id) => policy.included.includes(id))
}

export function permitsPath(policy: LiveSearchPolicy, path: string) {
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    return false
  return (
    !policy.pathPrefixes.length ||
    policy.pathPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  )
}

/**
 * Metadata reads are memoized on the request-scoped client, so neither tokens nor permissions
 * survive the request.
 * Optional document metadata must come from a current read using this verifier's client.
 */
export function createPolicyVerifier(
  provider: LiveSearchProvider,
  policy: LiveSearchPolicy,
  client: NativeClient | null,
  origin: string,
  mcp?: CodaMcpClient,
  /** A fresh verifier reads provider metadata again instead of reusing this client's responses. */
  options: { fresh?: boolean } = {}
): PolicyVerifier {
  if (!requiresScopedRetrieval(provider, policy)) return async () => true
  const json = (path: string, query?: Record<string, string>) => {
    if (!client)
      throw new NativeSearchError('unavailable', 'This connection cannot verify the search scope.')
    return client.json(path, { query, memo: !options.fresh })
  }
  const restricted = policy.mode === 'selected' || policy.excluded.length > 0
  const siteAllowed = (value: string) => {
    if (!policy.sites.length) return true
    try {
      return policy.sites.includes(new URL(value).host.toLowerCase())
    } catch {
      return policy.sites.includes(value.toLowerCase())
    }
  }
  const slackChannel = async (id: string) => {
    if (!id || !permitsResources(policy, [id])) return false
    const data = object(await json('/api/conversations.info', { channel: id }))
    if (data.ok !== true)
      throw new NativeSearchError(
        data.error === 'missing_scope' ? 'reconnect' : 'unavailable',
        'Reconnect Slack to verify channel access.'
      )
    const channel = object(data.channel)
    if (channel.id !== id) return false
    if (!policy.includeDirectMessages && (channel.is_im === true || channel.is_mpim === true))
      return false
    if (!policy.includeArchived && channel.is_archived === true) return false
    return true
  }
  return async (document, providerMetadata): Promise<boolean> => {
    if (provider === 'google_drive') {
      if (!restricted && !policy.fileTypes.length) return true
      const metadata = async (id: string) =>
        object(
          await json(`/drive/v3/files/${segment(id)}`, {
            fields: 'id,parents,driveId,mimeType,trashed',
            supportsAllDrives: 'true',
          })
        )
      const row = providerMetadata ?? (await metadata(document.id))
      if (row.id !== document.id || row.trashed === true) return false
      if (policy.fileTypes.length && !policy.fileTypes.includes(string(row.mimeType))) return false
      if (!restricted) return true
      const directParents = Array.isArray(row.parents) ? row.parents.map(string) : []
      const resources = new Set<string>([
        ...directParents,
        ...(row.driveId ? [`drive:${string(row.driveId)}`] : []),
      ])
      const visited = new Set<string>([document.id])
      const pending = [...directParents]
      while (pending.length) {
        if (visited.size > 40)
          throw new NativeSearchError('unavailable', 'The folder scope could not be verified.')
        const parent = pending.shift()!
        if (visited.has(parent)) return false
        visited.add(parent)
        const ancestor = await metadata(parent)
        if (ancestor.id !== parent || ancestor.trashed === true) return false
        for (const id of Array.isArray(ancestor.parents) ? ancestor.parents.map(string) : []) {
          resources.add(id)
          pending.push(id)
        }
      }
      if ([...resources].some((id) => policy.excluded.includes(id))) return false
      const includedResources = policy.includeSubfolders
        ? [...resources]
        : [...directParents, ...(row.driveId ? [`drive:${string(row.driveId)}`] : [])]
      return policy.mode === 'all' || includedResources.some((id) => policy.included.includes(id))
    }
    if (provider === 'gmail') {
      if (!restricted && !policy.excludePromotions && !policy.excludeSocial) return true
      const row =
        providerMetadata ??
        object(
          await json(`/gmail/v1/users/me/messages/${segment(document.id)}`, {
            format: 'metadata',
            fields: 'id,labelIds',
          })
        )
      if (row.id !== document.id || !Array.isArray(row.labelIds)) return false
      const ids = row.labelIds.map(string)
      if (policy.excludePromotions && ids.includes('CATEGORY_PROMOTIONS')) return false
      if (policy.excludeSocial && ids.includes('CATEGORY_SOCIAL')) return false
      if (!restricted) return true
      const labels = array(object(await json('/gmail/v1/users/me/labels')).labels)
      return permitsResources(
        policy,
        ids.flatMap((id) => [id, string(labels.find((label) => label.id === id)?.name)])
      )
    }
    if (provider === 'google_calendar') {
      if (!document.container) return false
      const row = object(
        await json(`/calendar/v3/users/me/calendarList/${segment(document.container)}`)
      )
      return (
        Boolean(row.id) &&
        permitsResources(policy, [string(row.id), ...(row.primary === true ? ['primary'] : [])])
      )
    }
    if (provider === 'slack') {
      if (policy.sites.length) {
        const identity = object(await json('/api/auth.test'))
        if (identity.ok !== true || !siteAllowed(string(identity.url))) return false
      }
      if (document.kind !== 'file') return slackChannel(document.container ?? '')
      const response = object(await json('/api/files.info', { file: document.id }))
      if (response.ok !== true)
        throw new NativeSearchError('reconnect', 'Reconnect Slack to verify file access.')
      const file = object(response.file)
      const channels = [file.channels, file.groups, file.ims].flatMap((ids) =>
        Array.isArray(ids) ? ids.map(string) : []
      )
      if (!channels.length) return !restricted && policy.includeDirectMessages
      if (channels.some((id) => policy.excluded.includes(id))) return false
      for (const id of channels) if (await slackChannel(id)) return true
      return false
    }
    if (provider === 'github') {
      const repository = document.container?.toLowerCase() ?? ''
      if (!repository || !permitsResources(policy, [repository])) return false
      if (document.kind === 'code' && !permitsPath(policy, document.id)) return false
      if (!policy.includeArchived) {
        const row = object(await json(`/repos/${repository}`))
        if (string(row.full_name).toLowerCase() !== repository || row.archived !== false)
          return false
      }
      return true
    }
    if (provider === 'gitlab') {
      if (!siteAllowed(origin) || !document.container) return false
      if (!restricted && policy.includeArchived && !policy.pathPrefixes.length) return true
      const row = object(await json(`/api/v4/projects/${segment(document.container)}`))
      if (!row.id || (!policy.includeArchived && row.archived !== false)) return false
      if (document.kind === 'code' && !permitsPath(policy, document.id)) return false
      return permitsResources(policy, [string(row.id), string(row.path_with_namespace)])
    }
    if (provider === 'jira' || provider === 'confluence') {
      if (!document.container) return false
      if (policy.sites.length) {
        const site = array(await json('/oauth/token/accessible-resources')).find(
          (site) => site.id === document.container
        )
        if (!site || !siteAllowed(string(site.url))) return false
      }
      if (!restricted) return true
      if (provider === 'jira') {
        const row = object(
          await json(
            `/ex/jira/${segment(document.container)}/rest/api/3/issue/${segment(document.id)}`,
            { fields: 'project' }
          )
        )
        const project = object(object(row.fields).project)
        return Boolean(project.key) && permitsResources(policy, [string(project.key)])
      }
      /** v2 reads, like document reads, so the check needs only the granular read scopes. */
      const api = `/ex/confluence/${segment(document.container)}/wiki/api/v2`
      let spaceKey = document.kind === 'space' ? document.id : ''
      if (!spaceKey) {
        const row = object(
          await json(
            `${api}/${document.kind === 'blogpost' ? 'blogposts' : 'pages'}/${segment(document.id)}`
          )
        )
        if (!string(row.spaceId)) return false
        spaceKey = string(object(await json(`${api}/spaces/${segment(string(row.spaceId))}`)).key)
      }
      return Boolean(spaceKey) && permitsResources(policy, [spaceKey])
    }
    if (provider === 'coda') {
      if (!restricted) return true
      let id = document.id
      if (id.startsWith('https://') && mcp) {
        const url = new URL(id)
        if (
          !['https://coda.io', 'https://docs.superhuman.com'].includes(url.origin) ||
          url.username ||
          url.password
        )
          return false
        const decoded = object(
          await mcp.call('url_convert', { action: 'decode', url: id, scope: 'document' })
        )
        id = string(decoded.docUri ?? decoded.uri)
      }
      const docId = mcp ? parseCodaResourceUri(id)?.docId : id
      return Boolean(docId) && permitsResources(policy, [docId!])
    }
    return false
  }
}
