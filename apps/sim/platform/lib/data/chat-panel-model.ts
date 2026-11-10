import type { MentionFamily } from '@/lib/api/contracts/organization-mentions'
import type { MothershipResource } from '@/lib/mothership/resources/types'
import { workspacePath } from '@/lib/navigation/paths'
import { isWorkspaceResourceKind, workspaceResourcePath } from '@/lib/resources'
import type { ChatContext } from '@/platform/lib/data/chat-types'
import { type SurfaceScope, surfaceHref } from '@/platform/lib/data/organization-model'

const RESOURCE_KIND: Partial<Record<string, string>> = {
  knowledgebase: 'knowledge',
  filefolder: 'folder',
}

/** The workspace tabs held behind a flag that a panel tab can link into. */
export interface PanelTabsShown {
  dashboards: boolean
  tests: boolean
}

/**
 * A workspace resource opens on its workspace page; any other opens beside the organization's Home.
 * A workflow folder opens the workflows list inside it. A dashboard or a test links into its tab
 * only while that tab is shown, and a generic card, which only the chat shows, links nowhere.
 */
export function resourceHref(
  scope: SurfaceScope,
  resource: MothershipResource,
  shown: PanelTabsShown
): string | undefined {
  if (!resource.workspaceId || resource.type === 'generic') return undefined
  if (resource.type === 'folder')
    return `${workspacePath(resource.workspaceId, 'workflows')}?${new URLSearchParams({ folderId: resource.id })}`
  const kind = RESOURCE_KIND[resource.type] ?? resource.type
  if (isWorkspaceResourceKind(kind))
    return workspaceResourcePath(resource.workspaceId, kind, resource.id)
  if (kind === 'dashboard')
    return shown.dashboards ? workspacePath(resource.workspaceId, 'dashboards') : undefined
  if (kind === 'test')
    return shown.tests
      ? workspacePath(resource.workspaceId, `tests/${encodeURIComponent(resource.id)}`)
      : undefined
  if (kind === 'log' && resource.executionId)
    return workspacePath(resource.workspaceId, `logs/${encodeURIComponent(resource.executionId)}`)
  return `${surfaceHref(scope, '/home')}?${new URLSearchParams({ resource: resource.id })}`
}

/** A kind that belongs to one workspace, which a workspace chat's older tabs leave implied. */
export function livesInWorkspace(type: string): boolean {
  const kind = RESOURCE_KIND[type] ?? type
  return isWorkspaceResourceKind(kind) || kind === 'dashboard' || kind === 'log'
}

/**
 * The families a panel tab shows, as its + picker offers them. Chats, skills and workflow, table
 * and knowledge base folders open no tab of their own, as in legacy's picker, and neither do file
 * folders, which no panel view renders. Dashboards are offered only while the Dashboard tab is
 * shown, which `grouped` decides.
 */
const PANEL_FAMILIES: ReadonlySet<MentionFamily> = new Set([
  'dashboards',
  'tables',
  'files',
  'knowledge_bases',
  'workflows',
  'logs',
])

/** Whether the panel's + picker offers rows of `family`. */
export function isPanelFamily(family: MentionFamily): boolean {
  return PANEL_FAMILIES.has(family)
}

/** The tab a picked reference opens, or nothing for a kind no tab shows. */
export function pickedResource(
  context: ChatContext,
  logIds: ReadonlyMap<string, string>
): MothershipResource | null {
  const owned = {
    title: context.label,
    workspaceId: 'workspaceId' in context ? context.workspaceId : undefined,
  }
  switch (context.kind) {
    case 'table':
      return { ...owned, type: 'table', id: context.tableId }
    case 'file':
      return { ...owned, type: 'file', id: context.fileId }
    case 'knowledge':
      return context.knowledgeId
        ? { ...owned, type: 'knowledgebase', id: context.knowledgeId }
        : null
    case 'workflow':
      return { ...owned, type: 'workflow', id: context.workflowId }
    case 'dashboard':
      return { ...owned, type: 'dashboard', id: context.dashboardId }
    case 'logs': {
      const id = context.executionId && logIds.get(context.executionId)
      return id ? { ...owned, type: 'log', id, executionId: context.executionId } : null
    }
    default:
      return null
  }
}
