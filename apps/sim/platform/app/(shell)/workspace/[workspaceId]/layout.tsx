import type { ReactNode } from 'react'
import { SkillsSession } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/skills-session/skills-session'

export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string }>
  children: ReactNode
}) {
  const { workspaceId } = await params
  return <SkillsSession key={workspaceId}>{children}</SkillsSession>
}
