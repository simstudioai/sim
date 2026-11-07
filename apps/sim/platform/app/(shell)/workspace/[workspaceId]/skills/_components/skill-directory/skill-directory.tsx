'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  DirectoryBack,
  DirectoryFilters,
  DirectoryGroup,
  DirectoryHeading,
  DirectoryList,
  DirectoryPage,
} from '@/platform/app/(shell)/_components/resource-directory/resource-directory'
import { useDirectorySearch } from '@/platform/app/(shell)/_components/resource-directory/use-directory-filter'
import type { SkillsData } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/skills-session/model'
import { useWorkspaceSkills } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/skills-session/skills-session'
import { SkillDetail } from '@/platform/app/(shell)/workspace/[workspaceId]/skills/_components/skill-detail/skill-detail'
import {
  ActivityRow,
  Button,
  EmptyState,
  Icon,
  SearchField,
} from '@/platform/design-system/components'
import { directoryHref } from '@/platform/design-system/navigation'

interface SkillsDirectoryProps {
  data: SkillsData | null
  workspaceId: string
  skillId?: string
}

export function SkillsDirectory({ data, workspaceId, skillId }: SkillsDirectoryProps) {
  const search = useSearchParams()
  const { query, setQuery } = useDirectorySearch()
  const session = useWorkspaceSkills(data)
  const base = `/workspace/${encodeURIComponent(workspaceId)}/skills`
  const href = (id?: string) =>
    directoryHref(id ? `${base}/${encodeURIComponent(id)}` : base, search, query)
  const filtered = session.skills.filter(({ name, description }) =>
    `${name} ${description}`.toLowerCase().includes(query.trim().toLowerCase())
  )
  if (skillId) {
    const selected = session.skills.find(({ id }) => id === skillId)
    return (
      <DirectoryPage>
        <DirectoryBack href={href()} label='Skills' />
        {data && (selected || (data.canCreate && skillId === 'new')) ? (
          <SkillDetail
            key={`${skillId}/${selected?.access ?? 'new'}`}
            data={data}
            skills={session.skills}
            skill={selected}
            onSave={(skill) => session.change(skill.id, skill)}
            onDelete={(id) => session.change(id, null)}
            href={href}
          />
        ) : (
          <EmptyState title='Skill not found' />
        )}
      </DirectoryPage>
    )
  }
  return (
    <DirectoryPage>
      <DirectoryHeading
        title='Skills'
        description='Reusable instructions for agents in this workspace.'
        action={
          data?.canCreate && (
            <Button variant='primary' icon='I074' render={<Link href={href('new')} />}>
              Add to Sim
            </Button>
          )
        }
      />
      <DirectoryList>
        {session.skills.length > 0 && (
          <DirectoryFilters
            search={
              <SearchField
                label='Search skills'
                placeholder='Search skills…'
                value={query}
                onValueChange={setQuery}
              />
            }
          />
        )}
        {filtered.length ? (
          <DirectoryGroup label='Workspace skills'>
            {filtered.map((skill) => (
              <ActivityRow
                key={skill.id}
                href={href(skill.id)}
                leading={<Icon name='I044' />}
                title={skill.name}
                detail={skill.description}
                textMetadata={skill.access === 'built-in' ? 'Built-in' : undefined}
              />
            ))}
          </DirectoryGroup>
        ) : (
          <EmptyState title={session.skills.length ? 'No matching skills' : 'No skills yet'} />
        )}
      </DirectoryList>
    </DirectoryPage>
  )
}
