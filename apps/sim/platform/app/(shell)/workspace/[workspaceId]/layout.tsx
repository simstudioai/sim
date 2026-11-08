import type { ReactNode } from 'react'
import { WorkspaceSession } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <WorkspaceSession>{children}</WorkspaceSession>
}
