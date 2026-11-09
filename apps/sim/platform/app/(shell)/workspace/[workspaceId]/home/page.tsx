import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

/**
 * The workspace's Home moved to its organization's Home. Fixture servers have no workspace to
 * resolve.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  const { redirectLegacyWorkspaceUrl } = await import('@/platform/lib/data/legacy-redirects')
  return redirectLegacyWorkspaceUrl(workspaceId, ['home'], query)
}
