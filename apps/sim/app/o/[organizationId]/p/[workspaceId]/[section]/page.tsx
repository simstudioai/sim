import { notFound, redirect } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import { isProjectSection } from '@/app/o/[organizationId]/p/routes'

interface ProjectSectionPageProps {
  params: Promise<{ organizationId: string; workspaceId: string; section: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** Existing project bookmarks enter the same shell as Home and organization chats. */
export default async function ProjectSectionPage({
  params,
  searchParams,
}: ProjectSectionPageProps) {
  const { organizationId, workspaceId, section } = await params
  if (!isProjectSection(section)) notFound()
  const incoming = await searchParams
  const query = new URLSearchParams({ project: workspaceId, section, pane: 'project' })
  for (const key of ['dashboard', 'edge', 'sync']) {
    const value = incoming[key]
    if (typeof value === 'string') query.set(key, value)
  }
  if (typeof incoming.resource === 'string') query.set('environment-resource', incoming.resource)
  redirect(`${organizationRoutes(organizationId).home}?${query}`)
}
