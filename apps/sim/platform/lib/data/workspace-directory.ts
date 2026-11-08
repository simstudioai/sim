import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { legacyUrl } from '@/platform/lib/data/surface'

/** Hand off live skills to the existing workspace access boundary. */
export function redirectWorkspaceSkillsToLegacy(
  workspaceId: string,
  detail: string[],
  search: Record<string, string | string[] | undefined>
): never {
  if (
    [workspaceId, ...detail].some(
      (part) => !part || part === '.' || part === '..' || /[/\\]/.test(part)
    ) ||
    detail.length > 1
  )
    notFound()
  const path = [
    '/workspace',
    encodeURIComponent(workspaceId),
    'skills',
    ...detail.map(encodeURIComponent),
  ].join('/')
  const filters = new URLSearchParams()
  const query = search.q ?? search.search
  if (typeof query === 'string' && query) filters.set('search', query)
  redirect(legacyUrl(filters.size ? `${path}?${filters}` : path))
}

/**
 * Hand a workspace tab that has no Platform data adapter yet to its legacy page, keeping the
 * reader's filters. A log's details open through the legacy list's execution parameter.
 */
export function redirectWorkspaceTabToLegacy(
  workspaceId: string,
  section: 'dashboards' | 'changelog' | 'logs',
  detail: string | undefined,
  search: Record<string, string | string[] | undefined>
): never {
  if (
    [workspaceId, detail].some(
      (part) => part !== undefined && (!part || part === '.' || part === '..' || /[/\\]/.test(part))
    )
  )
    notFound()
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (key === 'theme' || key === 'state' || value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item)
  }
  if (section === 'logs' && detail) query.set('executionId', detail)
  const path = ['/workspace', encodeURIComponent(workspaceId), section].join('/')
  redirect(legacyUrl(query.size ? `${path}?${query}` : path))
}
