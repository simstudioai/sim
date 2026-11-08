import type { ReactNode } from 'react'
import { SkillsSession } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/skills-session/skills-session'
import { WorkspaceSession } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'

export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string }>
  children: ReactNode
}) {
  const { workspaceId } = await params
  return (
    <SkillsSession key={workspaceId}>
      <WorkspaceSession>{children}</WorkspaceSession>
    </SkillsSession>
  )
}
