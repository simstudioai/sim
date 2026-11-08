import { EmptyState } from '@sim/emcn/empty-state'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  LiveWorkspaceSettings,
  WorkspaceSettings,
} from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/workspace-settings/workspace-settings'
import { loadWorkspaceSummary } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { readScenario } from '@/platform/lib/navigation'

export const metadata: Metadata = { title: 'Settings' }

export default async function Page({
  params,
  searchParams,
}: PageProps<'/workspace/[workspaceId]/settings'>) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  const mode = resolvePlatformMode()
  if (mode === 'live') return <LiveWorkspaceSettings workspaceId={workspaceId} />
  const workspace = await loadWorkspaceSummary(readScenario(query.state), workspaceId)
  if (!workspace) {
    if (mode === 'fixture') notFound()
    return <EmptyState title='Settings' description='No workspace data available.' />
  }
  return <WorkspaceSettings workspace={workspace} />
}
