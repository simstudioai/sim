import { EmptyState } from '@sim/emcn/empty-state'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { WORKSPACE_SETTINGS_SECTIONS } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import {
  LiveWorkspaceSettings,
  WorkspaceSettings,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/workspace-settings/workspace-settings'
import { loadWorkspaceSummary } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import {
  DEFAULT_WORKSPACE_SETTING,
  isWorkspaceSettingsKey,
  workspaceSettingTitle,
} from '@/platform/lib/data/workspace-settings'
import { readScenario } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'

export async function generateMetadata({
  params,
}: PageProps<'/workspace/[workspaceId]/settings/[[...section]]'>): Promise<Metadata> {
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
}: PageProps<'/workspace/[workspaceId]/settings/[[...section]]'>) {
  const [{ workspaceId, section: path = [] }, query] = await Promise.all([params, searchParams])
  const mode = resolvePlatformMode()
  if (mode !== 'live') {
    const workspace = await loadWorkspaceSummary(readScenario(query.state), workspaceId)
    if (!workspace) {
      if (mode === 'fixture') notFound()
      return <EmptyState title='Settings' description='No workspace data available.' />
    }
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
  if (!isWorkspaceSettingsKey(key)) notFound()
  const entry = WORKSPACE_SETTINGS_SECTIONS[key]
  if (subpath.length && !matchesSubpath(entry.subpaths, subpath)) notFound()
  const { default: Section } = await entry.load()
  return (
    <LiveWorkspaceSettings workspaceId={workspaceId} section={key}>
      <Section workspaceId={workspaceId} subpath={subpath} query={query} />
    </LiveWorkspaceSettings>
  )
}
