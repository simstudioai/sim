import type { ReactNode } from 'react'
import { WorkspaceSession } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

/** The mode is per-request; a build with no API origin must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceSession mode={resolvePlatformMode() === 'live' ? 'live' : 'fixture'}>
      {children}
    </WorkspaceSession>
  )
}
