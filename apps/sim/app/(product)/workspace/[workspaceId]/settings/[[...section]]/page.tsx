import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { matchPathPattern, searchParamsQuery, workspacePath } from '@/lib/navigation/paths'
import { WORKSPACE_SETTINGS_SUBPATHS } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import {
  LiveWorkspaceSettings,
  WorkspaceSettings,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/workspace-settings/workspace-settings'
import { WorkspaceSettingsSection } from '@/app/(product)/workspace/[workspaceId]/settings/_components/workspace-settings-section/workspace-settings-section'
import {
  DEFAULT_WORKSPACE_SETTING,
  isWorkspaceSettingsKey,
  workspaceSettingTitle,
} from '@/platform/lib/data/workspace-settings'
import { readScenario } from '@/platform/lib/navigation'
import type { ProductPageProps } from '@/platform/lib/route-props'

export async function generateMetadata({
  params,
}: ProductPageProps<{ workspaceId: string; section?: string[] }>): Promise<Metadata> {
  const { section: [key] = [] } = await params
  return { title: key ? workspaceSettingTitle(key) : 'Settings' }
}

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
  searchParams,
}: ProductPageProps<{ workspaceId: string; section?: string[] }>) {
  const [{ workspaceId, section: path = [] }, query] = await Promise.all([params, searchParams])
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const { loadWorkspaceSummary } = await import('@/platform/fixtures')
    const workspace = await loadWorkspaceSummary(readScenario(query.state), workspaceId)
    if (!workspace) notFound()
    return <WorkspaceSettings workspace={workspace} />
  }
  const [key, ...subpath] = path
  if (!key) {
    const params = searchParamsQuery(query)
    const destination = workspacePath(workspaceId, `settings/${DEFAULT_WORKSPACE_SETTING}`)
    redirect(params.size ? `${destination}?${params}` : destination)
  }
  if (!isWorkspaceSettingsKey(key)) {
    // A section that moved, such as one now in organization Settings, redirects; others 404.
    const { redirectLegacyWorkspaceUrl } = await import('@/platform/lib/data/legacy-redirects')
    return redirectLegacyWorkspaceUrl(workspaceId, ['settings', ...path], query)
  }
  if (
    subpath.length &&
    !WORKSPACE_SETTINGS_SUBPATHS[key]?.some((pattern) => matchPathPattern(pattern, subpath))
  )
    notFound()
  return (
    <LiveWorkspaceSettings workspaceId={workspaceId} section={key}>
      <WorkspaceSettingsSection
        section={key}
        workspaceId={workspaceId}
        subpath={subpath}
        query={query}
      />
    </LiveWorkspaceSettings>
  )
}
