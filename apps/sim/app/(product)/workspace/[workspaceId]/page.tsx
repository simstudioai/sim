import { redirect } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { platformHref } from '@/platform/lib/navigation'
import { workspaceHome } from '@/platform/lib/workspace-navigation'

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  const home = workspaceHome(resolvePlatformMode() === 'live' ? 'live' : 'fixture')
  redirect(
    platformHref(workspacePath(workspaceId, home), {
      get: (key) => (typeof query[key] === 'string' ? query[key] : null),
    })
  )
}
