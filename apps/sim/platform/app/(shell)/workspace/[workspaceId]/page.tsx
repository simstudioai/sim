import { redirect } from 'next/navigation'
import { platformHref } from '@/platform/lib/navigation'
import { workspaceEntry } from '@/platform/lib/workspace-navigation'

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  redirect(
    platformHref(workspaceEntry(workspaceId), {
      get: (key) => (typeof query[key] === 'string' ? query[key] : null),
    })
  )
}
