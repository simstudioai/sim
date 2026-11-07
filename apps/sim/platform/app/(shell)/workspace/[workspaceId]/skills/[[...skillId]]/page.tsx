import { notFound, redirect } from 'next/navigation'
import { SkillsDirectory } from '@/platform/app/(shell)/workspace/[workspaceId]/skills/_components/skill-directory/skill-directory'
import { directoryHref, readScenario } from '@/platform/design-system/navigation'
import { loadWorkspaceSkills } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export default async function Page({
  params,
  searchParams,
}: PageProps<'/workspace/[workspaceId]/skills/[[...skillId]]'>) {
  const [{ workspaceId, skillId }, query] = await Promise.all([params, searchParams])
  if (skillId && skillId.length !== 1) notFound()
  const legacySkill = typeof query.skillId === 'string' ? query.skillId : undefined
  const id = skillId?.[0] ?? legacySkill
  if (
    [workspaceId, id].some(
      (segment) => segment && (segment === '.' || segment === '..' || /[/\\]/.test(segment))
    )
  )
    notFound()
  if (resolvePlatformMode() === 'live') {
    const { redirectWorkspaceSkillsToLegacy } = await import(
      '@/platform/lib/data/workspace-directory'
    )
    redirectWorkspaceSkillsToLegacy(workspaceId, id ? [id] : [], query)
  }
  if ((!skillId && legacySkill) || (typeof query.search === 'string' && !query.q)) {
    const path = `/workspace/${encodeURIComponent(workspaceId)}/skills${id ? `/${encodeURIComponent(id)}` : ''}`
    const term = query.q ?? query.search
    redirect(
      directoryHref(
        path,
        { get: (key) => (typeof query[key] === 'string' ? query[key] : null) },
        typeof term === 'string' ? term : null,
        null
      )
    )
  }
  const data = await loadWorkspaceSkills(readScenario(query.state))
  return <SkillsDirectory data={data} workspaceId={workspaceId} skillId={skillId?.[0]} />
}
