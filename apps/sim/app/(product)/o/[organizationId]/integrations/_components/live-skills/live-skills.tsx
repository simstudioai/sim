'use client'

import type { ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { usePathname, useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import type { SkillsTab } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-center/integration-center'
import { QueryFailure } from '@/app/(product)/o/[organizationId]/integrations/_components/query-failure/query-failure'
import { SkillGroup } from '@/app/(product)/o/[organizationId]/integrations/_components/resource-list/resource-list'
import { SkillDetails } from '@/app/(product)/o/[organizationId]/integrations/_components/skill-details/skill-details'
import { useOrderedWorkspacesQuery, useSkills } from '@/platform/lib/data/skills'
import {
  centerParams,
  resourceDetailParams,
  serializeCenter,
  skillWorkspaceParams,
} from '@/platform/lib/integrations/center-navigation'

/**
 * The live Skills tab and the skill it opens. Skills belong to a workspace, so the tab lists one
 * workspace's skills at a time, starting with the viewer's first workspace.
 */
export function useLiveSkills(): { tab: SkillsTab; detail: ReactNode } {
  const pathname = usePathname()
  const search = useSearchParams()
  const [view, setView] = useQueryStates(
    { ...centerParams, ...resourceDetailParams, ...skillWorkspaceParams },
    { history: 'replace', shallow: true }
  )
  const workspaces = useOrderedWorkspacesQuery()
  const workspace =
    workspaces.data?.find((item) => item.id === view.workspace) ?? workspaces.data?.[0]
  const onSkills = view.tab === 'skills'
  const skills = useSkills(onSkills && workspace ? workspace.id : '')
  const listed = skills.isPlaceholderData ? undefined : skills.data
  const base = `${pathname}?${search.toString()}`
  const term = view.q.trim().toLowerCase()
  const rows = (listed ?? [])
    .filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(term))
    .sort((a, b) => (view.order === 'asc' ? 1 : -1) * a.name.localeCompare(b.name))
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      builtin: Boolean(skill.readOnly),
      href: serializeCenter(base, { resource: skill.id, resourceTab: null }),
    }))
  const open = (resource: string) =>
    void setView({ resource, resourceTab: null }, { history: 'push', scroll: false })
  const close = () =>
    void setView({ resource: null, resourceTab: null }, { history: 'push', scroll: false })

  const tab: SkillsTab = {
    filter: workspace && (
      <ChoiceMenu
        label='Workspace'
        value={workspace.id}
        options={(workspaces.data ?? []).map((item) => ({ label: item.name, value: item.id }))}
        onValueChange={(id) => void setView({ workspace: id })}
      />
    ),
    actions: (
      <Button
        variant='secondary'
        size='compact'
        icon='I074'
        disabled={!workspace}
        disabledReason='Skills belong to a workspace. Create a workspace first.'
        onClick={() => open('new')}
      >
        Create skill
      </Button>
    ),
    content: skills.error ? (
      <QueryFailure message='Could not load skills' query={skills} />
    ) : (
      <>
        <SkillGroup
          title='Workspace skills'
          skills={rows.filter((row) => !row.builtin)}
          onOpen={open}
        />
        <SkillGroup
          title='Built-in skills'
          skills={rows.filter((row) => row.builtin)}
          onOpen={open}
        />
      </>
    ),
    empty: !rows.length && !skills.error,
    settled: workspaces.isSuccess && (!workspace || Boolean(listed)),
  }

  const detail = onSkills && view.resource && (
    <SkillDetails
      key={`${workspace?.id ?? ''}:${view.resource}`}
      workspaceId={workspace?.id}
      skillId={view.resource === 'new' ? null : view.resource}
      backHref={serializeCenter(base, { resource: null, resourceTab: null })}
      onBack={close}
      onCreated={(resource) =>
        void setView({ resource, resourceTab: null }, { history: 'replace', scroll: false })
      }
    />
  )
  return { tab, detail }
}
