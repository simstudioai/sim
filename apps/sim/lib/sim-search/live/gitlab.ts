import { array, NativeSearchError, object, segment, string } from '@/lib/sim-search/live/http'
import { collectNativePages } from '@/lib/sim-search/live/pages'
import type {
  NativeClient,
  NativeDocument,
  NativePage,
  NativeSearchInput,
} from '@/lib/sim-search/live/types'

function document(row: Record<string, unknown>, kind: string): NativeDocument {
  return {
    id: kind === 'code' || kind === 'wiki' ? string(row.path) : string(row.iid),
    container: string(row.project_id),
    kind,
    ...(kind === 'code' && string(row.ref) ? { revision: string(row.ref) } : {}),
    title: string(row.title) || string(row.filename) || string(row.path),
    url: string(row.web_url),
    content: string(row.description) || string(row.data) || string(row.title),
    modifiedAt: string(row.updated_at),
    author: string(object(row.author).name),
  }
}

export async function searchGitLab(
  client: NativeClient,
  input: NativeSearchInput
): Promise<NativePage> {
  if (!input.native)
    return collectNativePages(
      ['issues', 'code'].map((kind) =>
        searchGitLab(client, {
          ...input,
          native: {
            provider: 'gitlab',
            query: input.query,
            kind: kind === 'code' ? 'code' : 'issues',
          },
        })
      ),
      'GitLab searches issues and code. Use nativeQueries.kind to narrow or paginate either collection.'
    )
  const kind = input.native?.kind ?? 'issues'
  const scopes: Record<string, string> = {
    issues: 'issues',
    code: 'blobs',
    merge_requests: 'merge_requests',
    wiki: 'wiki_blobs',
  }
  const scope = scopes[kind]
  if (!scope)
    throw new NativeSearchError(
      'unavailable',
      'GitLab supports issues, code, merge_requests, or wiki search.'
    )
  const page = input.native?.cursor ?? '1'
  if (!/^\d{1,4}$/.test(page) || Number(page) < 1)
    throw new NativeSearchError('unavailable', 'Invalid GitLab page.')
  const data = array(
    await client.json(
      input.native?.project
        ? `/api/v4/projects/${segment(input.native.project)}/search`
        : '/api/v4/search',
      {
        query: {
          scope,
          search: input.native?.query ?? input.query,
          per_page: String(input.limit),
          page,
        },
      }
    )
  )
  const documents = data.map((row) => document(row, kind))
  const projects = new Map<string, string>()
  for (const item of documents) {
    if (!item.url && item.container) {
      let url = projects.get(item.container)
      if (!url) {
        url = string(
          object(await client.json(`/api/v4/projects/${segment(item.container)}`)).web_url
        )
        projects.set(item.container, url)
      }
      item.url =
        kind === 'code'
          ? `${url}/-/blob/${segment(item.revision || 'HEAD')}/${item.id.split('/').map(segment).join('/')}`
          : kind === 'wiki'
            ? `${url}/-/wikis/${item.id.split('/').map(segment).join('/')}`
            : `${url}/-/${kind}/${segment(item.id)}`
    }
  }
  return {
    documents,
    ...(data.length === input.limit ? { nextCursor: String(Number(page) + 1) } : {}),
    message:
      'GitLab code/wiki/global search availability depends on the instance plan and enabled search backend. Set project to narrow to a project ID or path.',
  }
}

export async function readGitLab(
  client: NativeClient,
  id: string,
  project?: string,
  kind?: string,
  revision?: string
): Promise<NativeDocument> {
  if (!project) throw new NativeSearchError('unavailable', 'Missing GitLab project reference.')
  const path = `/api/v4/projects/${segment(project)}`
  const metadata = object(await client.json(path))
  if (kind === 'code') {
    const row = object(
      await client.json(`${path}/repository/files/${segment(id)}`, {
        query: { ref: revision || 'HEAD' },
      })
    )
    return {
      id,
      container: project,
      kind,
      revision,
      title: string(row.file_name),
      url: `${string(metadata.web_url)}/-/blob/${segment(revision || string(metadata.default_branch))}/${id.split('/').map(segment).join('/')}`,
      content: Buffer.from(string(row.content), 'base64').toString('utf8'),
    }
  }
  if (kind === 'wiki') {
    const row = object(await client.json(`${path}/wikis/${segment(id.replace(/\.md$/, ''))}`))
    return {
      id,
      container: project,
      kind,
      title: string(row.title),
      url: `${string(metadata.web_url)}/-/wikis/${segment(id)}`,
      content: string(row.content),
    }
  }
  if (!/^\d+$/.test(id))
    throw new NativeSearchError('unavailable', 'Invalid GitLab issue reference.')
  return document(
    object(
      await client.json(`${path}/${kind === 'merge_requests' ? 'merge_requests' : 'issues'}/${id}`)
    ),
    kind ?? 'issues'
  )
}
