import type { Metadata } from 'next'
import { SkillDetail } from '@/app/workspace/[workspaceId]/skills/[skillId]/skill-detail'

export const metadata: Metadata = {
  title: 'Skill',
}

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; skillId: string }>
}) {
  const { workspaceId, skillId } = await params
  return <SkillDetail workspaceId={workspaceId} skillId={skillId} />
}
