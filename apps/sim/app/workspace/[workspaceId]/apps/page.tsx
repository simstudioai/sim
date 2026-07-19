import { redirect } from 'next/navigation'

export default async function WorkspaceAppsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  redirect(`/workspace/${workspaceId}/home?mode=fullstack`)
}
