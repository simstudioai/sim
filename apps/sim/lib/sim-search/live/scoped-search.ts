import type { LiveSearchProvider } from '@/lib/api/contracts/mothership-assistant-tools'
import { parseCodaResourceUri } from '@/lib/sim-search/live/coda-uri'
import { escapeDriveLiteral } from '@/lib/sim-search/live/google'
import { array, object, string } from '@/lib/sim-search/live/http'
import { collectNativePages } from '@/lib/sim-search/live/pages'
import type { NativeClient, NativePage, NativeSearchInput } from '@/lib/sim-search/live/types'

/** Provider restrictions improve recall; the independent verifier remains authoritative. */
export async function searchWithinPolicy(
  provider: LiveSearchProvider,
  client: NativeClient | null,
  input: NativeSearchInput,
  search: (input: NativeSearchInput) => Promise<NativePage>
): Promise<NativePage> {
  const policy = input.policy
  if (!policy) return search(input)
  const query = input.native?.query ?? input.query
  const withQuery = (query: string): NativeSearchInput => ({
    ...input,
    native: { provider, ...input.native, query },
  })
  if (provider === 'gmail') {
    const label = (name: string) => `label:${JSON.stringify(name)}`
    return search(
      withQuery(
        [
          ...(query ? [`(${query})`] : []),
          ...(policy.mode === 'selected' ? [`{${policy.included.map(label).join(' ')}}`] : []),
          ...policy.excluded.map((id) => `-${label(id)}`),
          ...(policy.excludePromotions ? ['-category:promotions'] : []),
          ...(policy.excludeSocial ? ['-category:social'] : []),
        ].join(' ')
      )
    )
  }
  if (policy.mode !== 'selected') return search(input)
  const included = policy.included.filter((id) => !policy.excluded.includes(id))
  if (!included.length) return { documents: [] }
  if (provider === 'google_drive' && client) {
    const sharedDrives = included.filter((id) => id.startsWith('drive:'))
    const folderIds = included.filter((id) => !id.startsWith('drive:'))
    if (sharedDrives.length) {
      const targets = input.native?.project
        ? sharedDrives.filter((id) => id === input.native?.project)
        : sharedDrives
      const requests = targets.slice(0, 6).map(
        (id) => () =>
          search({
            ...input,
            native: {
              provider,
              query:
                input.native?.query ??
                (input.query
                  ? `fullText contains '${escapeDriveLiteral(input.query)}'`
                  : 'trashed = false'),
              ...input.native,
              project: id,
            },
          })
      )
      if (folderIds.length && !input.native?.project)
        requests.push(() =>
          searchWithinPolicy(
            provider,
            client,
            { ...input, policy: { ...policy, included: folderIds } },
            search
          )
        )
      if (!requests.length) return { documents: [] }
      if (requests.length === 1) return requests[0]!()
      const result = await collectNativePages(
        requests.map((request) => request()),
        'Target one shared drive to continue searching.'
      )
      return { ...result, partial: result.partial || targets.length > 6 }
    }
    const folders = new Set(folderIds)
    const frontier = [...folders]
    let partial = false
    if (policy.includeSubfolders) {
      for (let round = 0; frontier.length && round < 10; round++) {
        const parents = frontier.splice(0, 20)
        const data = object(
          await client.json('/drive/v3/files', {
            query: {
              q: `trashed = false and mimeType = 'application/vnd.google-apps.folder' and (${parents.map((id) => `'${escapeDriveLiteral(id)}' in parents`).join(' or ')})`,
              fields: 'nextPageToken,files(id)',
              pageSize: '100',
              supportsAllDrives: 'true',
              includeItemsFromAllDrives: 'true',
            },
          })
        )
        partial ||= Boolean(data.nextPageToken)
        for (const row of array(data.files)) {
          const id = string(row.id)
          if (!id || folders.has(id) || policy.excluded.includes(id)) continue
          if (folders.size >= 200) {
            partial = true
            break
          }
          folders.add(id)
          frontier.push(id)
        }
      }
      partial ||= frontier.length > 0
    }
    const text =
      input.native?.query ??
      (input.query ? `fullText contains '${escapeDriveLiteral(input.query)}'` : 'trashed = false')
    const result = await search(
      withQuery(
        `(${text}) and (${[...folders].map((id) => `'${escapeDriveLiteral(id)}' in parents`).join(' or ')})`
      )
    )
    return { ...result, partial: result.partial || partial }
  }
  if (provider === 'github') {
    const explicit = [...query.matchAll(/(?:^|\s)repo:([\w.-]+\/[\w.-]+)/gi)].map((match) =>
      match[1]!.toLowerCase()
    )
    const targets = explicit.length ? included.filter((id) => explicit.includes(id)) : included
    if (!targets.length) return { documents: [] }
    const clean = query.replace(/(?:^|\s)(?:repo|org|user):[^\s]+/gi, ' ').trim()
    if (targets.length === 1) return search(withQuery(`${clean} repo:${targets[0]}`))
    const result = await collectNativePages(
      targets.slice(0, 6).map((id) =>
        search({
          ...withQuery(`${clean} repo:${id}`),
          native: { ...withQuery(`${clean} repo:${id}`).native!, cursor: undefined },
        })
      ),
      'Searched the repositories allowed by your organization.'
    )
    return { ...result, partial: result.partial || targets.length > 6 }
  }
  if (provider === 'gitlab' || provider === 'google_calendar' || provider === 'coda') {
    const canonical = (id: string) => (provider === 'coda' ? `superhuman://docs/${id}` : id)
    const requested =
      provider === 'coda' && input.native?.project
        ? parseCodaResourceUri(input.native.project)?.docId
        : input.native?.project
    const targets = input.native?.project
      ? included.filter((id) =>
          provider === 'coda' ? id === requested : canonical(id) === requested
        )
      : included
    if (!targets.length) return { documents: [] }
    if (targets.length === 1)
      return search({
        ...input,
        native: { provider, ...input.native, query, project: canonical(targets[0]!) },
      })
    const result = await collectNativePages(
      targets.slice(0, 6).map((id) =>
        search({
          ...input,
          native: { provider, ...input.native, query, project: canonical(id), cursor: undefined },
        })
      ),
      'Searched the sources allowed by your organization. Target one source to continue searching.'
    )
    return { ...result, partial: result.partial || targets.length > 6 }
  }
  if (provider === 'slack') {
    if (included.length === 1) return search(withQuery(`${query} in:<#${included[0]}>`))
    const result = await collectNativePages(
      included.slice(0, 4).map((id) =>
        search({
          ...withQuery(`${query} in:<#${id}>`),
          native: { ...withQuery(`${query} in:<#${id}>`).native!, cursor: undefined },
        })
      ),
      'Searched the channels allowed by your organization.'
    )
    return { ...result, partial: result.partial || included.length > 4 }
  }
  return search(input)
}
