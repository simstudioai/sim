'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { useSkills } from '@/platform/lib/data/skills'
import {
  integrationsPageParams,
  serializeIntegrationsPage,
} from '@/platform/lib/integrations/center-navigation'
import { platformHref } from '@/platform/lib/navigation'
import { compareText } from '@/platform/shared/time'

/**
 * The live Skills tab's rows and the skill it opens, in the workspace the page lists every tab
 * within. Skills belong to a workspace, so with none there are no rows and no skill to open. Data and
 * actions; the route renders them.
 */
export function useLiveSkills(workspaceId: string | undefined) {
  const pathname = usePathname()
  const search = useSearchParams()
  const [view, setView] = useQueryStates(integrationsPageParams, {
    history: 'replace',
    shallow: true,
  })
  const onSkills = view.tab === 'skills' && Boolean(workspaceId)
  const query = useSkills(onSkills && workspaceId ? workspaceId : '')
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
    query,
    rows,
    settled: Boolean(listed),
    open,
    /** The skill the URL opens on the Skills tab, `null` for a new one; absent when none is open. */
    detail:
      onSkills && workspaceId && view.resource
        ? { workspaceId, skillId: view.resource === 'new' ? null : view.resource }
        : undefined,
    detailBackHref: linkTo(null),
    closeDetail: () =>
      void setView({ resource: null, resourceTab: null }, { history: 'push', scroll: false }),
    created: (resource: string) =>
      void setView({ resource, resourceTab: null }, { history: 'replace', scroll: false }),
  }
}
