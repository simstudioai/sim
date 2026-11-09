import type { ReactNode } from 'react'
import { WorkspaceSession } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

/** The mode is per-request; a build with no API origin must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  if (resolvePlatformMode() !== 'live')
    return <WorkspaceSession mode='fixture'>{children}</WorkspaceSession>
  const [{ WorkspaceRealtime }, { readWorkspaceTabFlags }] = await Promise.all([
    import('@/platform/lib/data/realtime'),
    import('@/platform/lib/data/workspace-tab-flags'),
  ])
  return (
    <WorkspaceSession mode='live' tabFlags={await readWorkspaceTabFlags()}>
      <WorkspaceRealtime>{children}</WorkspaceRealtime>
    </WorkspaceSession>
  )
}
