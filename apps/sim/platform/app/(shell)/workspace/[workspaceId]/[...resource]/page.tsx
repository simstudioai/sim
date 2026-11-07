import { EmptyState } from '@sim/emcn/empty-state'
import { notFound, redirect } from 'next/navigation'
import { WorkspacePane } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-pane/workspace-pane'
import { loadShellData } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { platformHref, readAppearance, readScenario } from '@/platform/lib/navigation'
import { WORKSPACE_PAGES, workspacePath } from '@/platform/lib/workspace-navigation'

export default async function ResourcePage({
  params,
  searchParams,
}: PageProps<'/workspace/[workspaceId]/[...resource]'>) {
  const [{ workspaceId, resource }, search] = await Promise.all([params, searchParams])
  const [section, detail] = resource
  const page = WORKSPACE_PAGES.find((item) => item.section === section)
  if (
    (!page && section !== 'w') ||
    [workspaceId, ...resource].some(
      (segment) => !segment || segment === '.' || segment === '..' || /[/\\]/.test(segment)
    )
  )
    notFound()
  if (resolvePlatformMode() === 'live') {
    const { legacyUrl } = await import('@/platform/lib/data/surface')
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(search)) {
      if (key === 'theme' || key === 'state' || value === undefined) continue
      for (const item of Array.isArray(value) ? value : [value]) query.append(key, item)
    }
    const path = workspacePath(workspaceId, resource.map(encodeURIComponent).join('/'))
    redirect(legacyUrl(query.size ? `${path}?${query}` : path))
  }
  const scenario = readScenario(search.state)
  const data = await loadShellData(scenario)
  const workspace = data?.workspaces.find((item) => item.id === workspaceId)
  const workflows = workspace?.workflows ?? []
  if (!data)
    return (
      <EmptyState title={page?.label ?? 'Workflows'} description='No workspace data available.' />
    )
  if (page && resource.length !== 1) notFound()
  if (section === 'w') {
    if (resource.length > 2 || (detail && !workflows.some((item) => item.id === detail))) notFound()
    if (!detail) {
      if (!workflows.length) return <EmptyState title='No workflows yet' />
      redirect(
        platformHref(workspacePath(workspaceId, `w/${encodeURIComponent(workflows[0].id)}`), {
          get: (key) => (typeof search[key] === 'string' ? search[key] : null),
        })
      )
    }
  }
  return (
    <WorkspacePane
      section={section}
      title={page?.label ?? workflows.find((item) => item.id === detail)?.name ?? 'Workflow'}
      workflowId={detail}
      scenario={scenario}
      theme={readAppearance(search.theme)}
    />
  )
}
