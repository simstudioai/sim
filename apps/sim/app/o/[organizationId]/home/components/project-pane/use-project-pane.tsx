import { useEffect } from 'react'
import type { TabStripItem } from '@sim/emcn'
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
import type { ResourcePanelNavigation } from '@/app/workspace/[workspaceId]/home/components/resource-panel-navigation'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'

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
  const activeBrowse = params.browse.find((tab) => tab.split(':')[0] === params.pane)
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
  const showProject = params.pane === 'project' || (!activeBrowse && !hasActiveResource)
  const browse = (workspaceId = params.project, kind = '') => {
    const id = generateShortId(8)
    void setParams({ pane: id, browse: [...params.browse, `${id}:${workspaceId}:${kind}`] })
    onReveal()
  }
  const select = (id: string) => {
    void setParams({ pane: id })
    onReveal()
  }
  const close = (id: string) => {
    const index = params.browse.findIndex((tab) => tab.split(':')[0] === id)
    const remaining = params.browse.filter((tab) => tab.split(':')[0] !== id)
    const neighbor = remaining[Math.max(0, index - 1)]?.split(':')[0]
    void setParams(
      {
        browse: remaining,
        ...(params.pane === id ? { pane: neighbor ?? (hasActiveResource ? null : 'project') } : {}),
      },
      { history: 'replace' }
    )
  }
  const tabs: TabStripItem[] = [
    ...params.browse.map((tab) => ({
      id: tab.split(':')[0],
      title: 'New tab',
      active: tab === activeBrowse,
    })),
  ]
  const navigation: ResourcePanelNavigation = {
    control: <ProjectControl active={showProject} onShow={() => select('project')} />,
    tabs,
    active: showProject || Boolean(activeBrowse),
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
    content: activeBrowse ? (
      <ProjectResourceBrowser
        key={activeBrowse}
        tab={activeBrowse}
        resources={resources}
        desktopScopeId={desktopScopeId}
      />
    ) : showProject ? (
      <ProjectPaneContent />
    ) : null,
  }
  return { navigation }
}
