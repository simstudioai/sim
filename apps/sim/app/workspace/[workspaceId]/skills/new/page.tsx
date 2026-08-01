import type { Metadata } from 'next'
import { SkillCreate } from '@/app/workspace/[workspaceId]/skills/new/skill-create'

export const metadata: Metadata = {
  title: 'New Skill',
}

export default async function SkillCreatePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  return <SkillCreate workspaceId={workspaceId} />
}
