import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

/**
 * A workspace chat moved to its organization's chats. Fixture servers have no workspace to
 * resolve.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; chatId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId, chatId }, query] = await Promise.all([params, searchParams])
  const { redirectLegacyWorkspaceUrl } = await import('@/platform/lib/data/legacy-redirects')
  return redirectLegacyWorkspaceUrl(workspaceId, ['chat', chatId], query)
}
