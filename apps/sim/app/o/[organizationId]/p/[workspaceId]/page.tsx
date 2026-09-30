import { redirect } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'

export default async function ProjectIndexPage({
  params,
}: {
  params: Promise<{ organizationId: string; workspaceId: string }>
}) {
  const { organizationId, workspaceId } = await params
  redirect(organizationRoutes(organizationId).project(workspaceId))
}
