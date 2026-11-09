import { redirect } from 'next/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'

/**
 * Legacy's standalone viewer framed the raw file without chrome. The file page already renders every
 * type legacy previews, with its actions, so an old link opens it there.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string; fileId: string }>
}) {
  const { workspaceId, fileId } = await params
  redirect(`${workspacePath(workspaceId, 'files')}/${encodeURIComponent(fileId)}`)
}
