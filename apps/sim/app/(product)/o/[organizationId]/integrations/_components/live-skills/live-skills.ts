'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { useOrderedWorkspacesQuery, useSkills } from '@/platform/lib/data/skills'
import {
  integrationsPageParams,
  serializeIntegrationsPage,
} from '@/platform/lib/integrations/center-navigation'
import { platformHref } from '@/platform/lib/navigation'
import { compareText } from '@/platform/shared/time'

/**
 * The live Skills tab's rows and the skill it opens. Skills belong to a workspace, so the tab lists
 * one workspace's skills at a time, starting with the viewer's first workspace. A page that chooses
 * the workspace for every tab passes it as `pageWorkspaceId`, and the tab then offers no choice of
 * its own. Data and actions; the route renders them.
 */
export function useLiveSkills(pageWorkspaceId?: string) {
  const pathname = usePathname()
  const search = useSearchParams()
  const [view, setView] = useQueryStates(integrationsPageParams, {
    history: 'replace',
    shallow: true,
  })
  const workspaces = useOrderedWorkspacesQuery()
  const workspace = pageWorkspaceId
    ? workspaces.data?.find((item) => item.id === pageWorkspaceId)
    : (workspaces.data?.find((item) => item.id === view.workspace) ?? workspaces.data?.[0])
  const onSkills = view.tab === 'skills'
  const query = useSkills(onSkills && workspace ? workspace.id : '')
  const listed = query.isPlaceholderData ? undefined : query.data
  const base = platformHref(pathname, search)
  const linkTo = (resource: string | null) =>
    serializeIntegrationsPage(base, { ...view, resource, resourceTab: null })
  const term = view.q.trim().toLowerCase()
  const rows = (listed ?? [])
    .filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(term))
    .sort((a, b) => (view.order === 'asc' ? 1 : -1) * compareText(a.name, b.name))
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      href: linkTo(skill.id),
    }))
  const open = (resource: string) =>
    void setView({ resource, resourceTab: null }, { history: 'push', scroll: false })

  return {
    workspace,
    /** The tab's own workspace choice, absent where the page chooses for every tab. */
    workspaceOptions:
      !pageWorkspaceId && workspace
        ? (workspaces.data ?? []).map((item) => ({ label: item.name, value: item.id }))
        : undefined,
    chooseWorkspace: (id: string) => void setView({ workspace: id }),
    query,
    rows,
    settled: workspaces.isSuccess && (!workspace || Boolean(listed)),
    open,
    /** The skill the URL opens on the Skills tab, `null` for a new one; absent when none is open. */
    detail:
      onSkills && view.resource
        ? { skillId: view.resource === 'new' ? null : view.resource }
        : undefined,
    detailBackHref: linkTo(null),
    closeDetail: () =>
      void setView({ resource: null, resourceTab: null }, { history: 'push', scroll: false }),
    created: (resource: string) =>
      void setView({ resource, resourceTab: null }, { history: 'replace', scroll: false }),
  }
}
