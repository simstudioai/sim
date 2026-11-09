import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { WORKSPACE_SETTINGS_SUBPATHS } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import {
  LiveWorkspaceSettings,
  WorkspaceSettings,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/workspace-settings/workspace-settings'
import { WorkspaceSettingsSection } from '@/app/(product)/workspace/[workspaceId]/settings/_components/workspace-settings-section/workspace-settings-section'
import { loadWorkspaceSummary } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
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

function matchesSubpath(patterns: readonly string[] | undefined, subpath: readonly string[]) {
  return Boolean(
    patterns?.some((pattern) => {
      const segments = pattern.split('/')
      return (
        segments.length === subpath.length &&
        segments.every((value, index) => value.startsWith(':') || value === subpath[index])
      )
    })
  )
}

export default async function Page({
  params,
  searchParams,
}: ProductPageProps<{ workspaceId: string; section?: string[] }>) {
  const [{ workspaceId, section: path = [] }, query] = await Promise.all([params, searchParams])
  if (resolvePlatformMode() !== 'live') {
    const workspace = await loadWorkspaceSummary(readScenario(query.state), workspaceId)
    if (!workspace) notFound()
    return <WorkspaceSettings workspace={workspace} />
  }
  const [key, ...subpath] = path
  if (!key) {
    const params = new URLSearchParams()
    for (const [name, value] of Object.entries(query)) {
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
        params.append(name, item)
    }
    const destination = workspacePath(workspaceId, `settings/${DEFAULT_WORKSPACE_SETTING}`)
    redirect(params.size ? `${destination}?${params}` : destination)
  }
  if (!isWorkspaceSettingsKey(key)) {
    // A section that moved, such as one now in organization Settings, redirects; others 404.
    const { redirectLegacyWorkspaceUrl } = await import('@/platform/lib/data/legacy-redirects')
    return redirectLegacyWorkspaceUrl(workspaceId, ['settings', ...path], query)
  }
  if (subpath.length && !matchesSubpath(WORKSPACE_SETTINGS_SUBPATHS[key], subpath)) notFound()
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
