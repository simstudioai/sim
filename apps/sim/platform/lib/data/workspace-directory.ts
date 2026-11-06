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
