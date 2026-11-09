import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

/**
 * Skills moved to the organization's integration center, scoped to this workspace. Fixture servers
 * have no workspace to resolve.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; path?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId, path = [] }, query] = await Promise.all([params, searchParams])
  const { redirectLegacyWorkspaceUrl } = await import('@/platform/lib/data/legacy-redirects')
  return redirectLegacyWorkspaceUrl(workspaceId, ['skills', ...path], query)
}
