import { useEffect } from 'react'
import type { TabStripItem } from '@sim/emcn'
import { ArrowLeftRight } from '@sim/emcn/icons'
import { generateShortId } from '@sim/utils/id'
import { useQueryStates } from 'nuqs'
import { getChatResourceSelectionId } from '@/lib/mothership/resources/types'
import { ProjectControl } from '@/app/o/[organizationId]/home/components/project-pane/project-control'
import { ProjectPaneContent } from '@/app/o/[organizationId]/home/components/project-pane/project-pane-content'
import { ProjectResourceBrowser } from '@/app/o/[organizationId]/home/components/project-pane/project-resource-browser'
import {
  projectPaneOptions,
  projectPaneParsers,
} from '@/app/o/[organizationId]/home/components/project-pane/search-params'
import { EnvironmentSync } from '@/app/o/[organizationId]/p/components/environments/environment-sync'
import type { ResourcePanelNavigation } from '@/app/workspace/[workspaceId]/home/components/resource-panel-navigation'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

const RESOURCE_SECTIONS: Partial<Record<MothershipResource['type'], string>> = {
  workflow: 'workflows',
  table: 'tables',
  knowledgebase: 'knowledge',
  file: 'files',
  log: 'logs',
}

/** UI tabs never enter the chat's persisted resource list or execution context. */
export function useProjectPane(
  resources: MothershipResource[],
  activeResourceId: string | null,
  desktopScopeId: string,
  onReveal: () => void
) {
  const [params, setParams] = useQueryStates(projectPaneParsers, projectPaneOptions)
  const { data: workspaces } = useWorkspacesQuery()
  const activeTab = params.tabs.find((tab) => tab.id === params.pane)
  const dashboard = resources.find(
    (resource) =>
      resource.type === 'dashboard' && getChatResourceSelectionId(resource) === activeResourceId
  )
  useEffect(() => {
    if (dashboard?.workspaceId && !params.pane) {
      void setParams(
        { project: dashboard.workspaceId, section: 'dashboard', pane: 'project' },
        { history: 'replace' }
      )
      onReveal()
    }
  }, [dashboard?.workspaceId, params.pane, setParams, onReveal])
  const hasActiveResource = resources.some(
    (resource) => getChatResourceSelectionId(resource) === activeResourceId
  )
  const showProject = params.pane === 'project' || (!activeTab && !hasActiveResource)
  const browse = (workspaceId = params.project, kind = '') => {
    const id = generateShortId(8)
    void setParams({
      pane: id,
      tabs: [...params.tabs, { kind: 'browse', id, workspaceId, resourceKind: kind }],
    })
    onReveal()
  }
  const select = (id: string) => {
    void setParams({ pane: id })
    onReveal()
  }
  const close = (id: string) => {
    const index = params.tabs.findIndex((tab) => tab.id === id)
    const remaining = params.tabs.filter((tab) => tab.id !== id)
    const neighbor = remaining[Math.max(0, index - 1)]?.id
    void setParams(
      {
        tabs: remaining,
        ...(params.pane === id ? { pane: neighbor ?? (hasActiveResource ? null : 'project') } : {}),
      },
      { history: 'replace' }
    )
  }
  const nameOf = new Map(workspaces?.map((workspace) => [workspace.id, workspace.name]))
  const parentOf = new Map(
    workspaces?.map((workspace) => [workspace.id, workspace.forkedFromWorkspaceId ?? ''])
  )
  const tabs: TabStripItem[] = params.tabs.map((tab) => {
    if (tab.kind === 'browse') return { id: tab.id, title: 'New tab', active: tab === activeTab }
    const child = nameOf.get(tab.childId) ?? 'Fork'
    const parent = nameOf.get(parentOf.get(tab.childId) ?? '') ?? 'Parent'
    return {
      id: tab.id,
      title: tab.direction === 'push' ? `${child} → ${parent}` : `${parent} → ${child}`,
      icon: <ArrowLeftRight className='size-[14px]' />,
      active: tab === activeTab,
    }
  })
  const navigation: ResourcePanelNavigation = {
    control: <ProjectControl active={showProject} onShow={() => select('project')} />,
    tabs,
    active: showProject || Boolean(activeTab),
    onSelect: select,
    onClose: close,
    onNew: () => browse(),
    onBrowseResource: (resource) => {
      const kind = RESOURCE_SECTIONS[resource.type]
      if (!kind || !resource.workspaceId) return
      void setParams({
        project: resource.workspaceId,
        section: 'resources',
        resourceKind: kind,
        resourceDetail: '',
        pane: 'project',
      })
      onReveal()
    },
    content:
      activeTab?.kind === 'sync' ? (
        <EnvironmentSync tab={activeTab} />
      ) : activeTab ? (
        <ProjectResourceBrowser
          key={activeTab.id}
          tab={activeTab}
          resources={resources}
          desktopScopeId={desktopScopeId}
        />
      ) : showProject ? (
        <ProjectPaneContent />
      ) : null,
  }
  return { navigation }
}
