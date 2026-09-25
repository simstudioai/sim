import { useMemo, useSyncExternalStore } from 'react'
import { isBrowserAgentAvailable } from '@/lib/browser-agent/transport'
import { DASHBOARD_CONTENT_TYPE, dashboardDisplayName } from '@/lib/dashboards/resource'
import { subscribeDesktopPreferences } from '@/lib/desktop'
import { isTerminalAvailable } from '@/lib/terminal/transport'
import type { AvailableItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-folder-tree'
import {
  byResourceMenuOrder,
  getResourceConfig,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type { MothershipResourceType } from '@/app/workspace/[workspaceId]/home/types'
import { formatDate } from '@/app/workspace/[workspaceId]/logs/utils'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { listIntegrationsByPopularity } from '@/blocks/integration-matcher'
import { useFolders } from '@/hooks/queries/folders'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useLogsList } from '@/hooks/queries/logs'
import { useMothershipChats } from '@/hooks/queries/mothership-chats'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFileFolders } from '@/hooks/queries/workspace-file-folders'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

/**
 * Placeholder id for the Browser launcher row. It never names a resource: the
 * page the desktop app creates becomes the browser tab, keyed by its own id.
 */
export const BROWSER_LAUNCHER_ID = 'browser'

/** Placeholder id for the Terminal launcher row; the shell the desktop app opens becomes the tab. */
export const TERMINAL_LAUNCHER_ID = 'terminal'

export interface AvailableItemsByType {
  type: MothershipResourceType
  items: AvailableItem[]
}

/**
 * Table and knowledge-base folder hierarchies. Chat also offers these as folder
 * mentions, while the resource tab picker uses them only for navigation.
 */
export interface StructureFolders {
  table: AvailableItem[]
  knowledgebase: AvailableItem[]
}

export interface AvailableResources {
  groups: AvailableItemsByType[]
  structureFolders: StructureFolders
  /**
   * True while enabled and at least one list has yet to produce data. Callers
   * that act on "no candidates" must check this first — an empty result during
   * hydration means "not known yet", not "no match".
   */
  isHydrating: boolean
}

interface UseAvailableResourcesOptions {
  /** Chat can attach every folder family, so these lists also gate mention hydration. */
  includeFolderMentions?: boolean
  /**
   * Skips the underlying list queries and the group construction they feed
   * while `false`, returning a stable empty result. Menus pass their own open
   * state so a closed one costs nothing; the lists fetch on first open.
   *
   * Note this only defers the lists nothing else on the surface already needs —
   * the mothership tab bar independently resolves tab names from the workflow,
   * table, file, knowledge-base, and folder lists, so those stay warm there.
   */
  enabled?: boolean
  /**
   * Resource types to omit from the result. Must be referentially stable
   * (a module constant) — it keys the group memo.
   */
  excludeTypes?: readonly MothershipResourceType[]
}

/** Stable identity for the disabled result, so downstream memos never bust. */
const NO_RESOURCE_GROUPS: AvailableItemsByType[] = []

const LOG_DROPDOWN_LIMIT = 50

const LOG_DROPDOWN_FILTERS = {
  timeRange: 'All time' as const,
  level: 'all',
  workflowIds: [] as string[],
  folderIds: [] as string[],
  triggers: [] as string[],
  searchQuery: '',
  limit: LOG_DROPDOWN_LIMIT,
  sortBy: 'date' as const,
  sortOrder: 'desc' as const,
}

export function useAvailableResources(
  workspaceId: string,
  options?: UseAvailableResourcesOptions
): AvailableResources {
  const dashboardsEnabled = useFeatureFlag('dashboards')
  const enabled = options?.enabled ?? true
  const excludeTypes = options?.excludeTypes
  const browserAvailable = useSyncExternalStore(
    subscribeDesktopPreferences,
    isBrowserAgentAvailable,
    () => false
  )
  const terminalAvailable = useSyncExternalStore(
    subscribeDesktopPreferences,
    isTerminalAvailable,
    () => false
  )
  // Destructured without `= []` defaults on purpose: a literal default allocates a
  // fresh array every render while `data` is undefined (exactly the disabled state),
  // which would bust the group memo below on every render. Undefined is stable.
  const { data: workflows, isPending: workflowsPending } = useWorkflows(workspaceId, {
    enabled: enabled && Boolean(workspaceId),
  })
  const { data: tables, isPending: tablesPending } = useTablesList(workspaceId, 'active', {
    enabled: enabled && Boolean(workspaceId),
  })
  const { data: files, isPending: filesPending } = useWorkspaceFiles(workspaceId, 'active', {
    enabled: enabled && Boolean(workspaceId),
  })
  const { data: knowledgeBases, isPending: knowledgeBasesPending } = useKnowledgeBasesQuery(
    workspaceId,
    { enabled: enabled && Boolean(workspaceId) }
  )
  const { data: folders, isPending: foldersPending } = useFolders(workspaceId, {
    enabled: enabled && Boolean(workspaceId),
  })
  const { data: tableFolders, isPending: tableFoldersPending } = useFolders(workspaceId, {
    enabled: enabled && Boolean(workspaceId) && !excludeTypes?.includes('table'),
    resourceType: 'table',
  })
  const { data: knowledgeBaseFolders, isPending: knowledgeBaseFoldersPending } = useFolders(
    workspaceId,
    {
      enabled: enabled && Boolean(workspaceId) && !excludeTypes?.includes('knowledgebase'),
      resourceType: 'knowledge_base',
    }
  )
  const { data: fileFolders, isPending: fileFoldersPending } = useWorkspaceFileFolders(
    workspaceId,
    'active',
    { enabled: enabled && Boolean(workspaceId) }
  )
  const { data: tasks, isPending: tasksPending } = useMothershipChats(workspaceId, {
    enabled: enabled && Boolean(workspaceId),
  })
  const { data: logsData, isPending: logsPending } = useLogsList(
    workspaceId,
    LOG_DROPDOWN_FILTERS,
    { enabled: enabled && Boolean(workspaceId) }
  )
  const logs = useMemo(() => (logsData?.pages ?? []).flatMap((page) => page.logs), [logsData])

  /**
   * Keyed off `isPending` rather than `data === undefined` so a failed list
   * settles to "not hydrating" — an errored query must not block the caller
   * forever.
   *
   * Chat includes table and knowledge-base folders as candidates. Its Enter
   * handling must wait for those lists too, or an unresolved mention can submit.
   */
  const isHydrating =
    enabled &&
    Boolean(workspaceId) &&
    (workflowsPending ||
      tablesPending ||
      filesPending ||
      knowledgeBasesPending ||
      foldersPending ||
      (options?.includeFolderMentions &&
        ((!excludeTypes?.includes('table') && tableFoldersPending) ||
          (!excludeTypes?.includes('knowledgebase') && knowledgeBaseFoldersPending))) ||
      fileFoldersPending ||
      tasksPending ||
      logsPending)

  const groups = useMemo(() => {
    if (!enabled) return NO_RESOURCE_GROUPS
    const excluded = new Set<MothershipResourceType>(excludeTypes ?? [])
    if (!dashboardsEnabled) excluded.add('dashboard')
    const groups: AvailableItemsByType[] = [
      {
        type: 'workflow' as const,
        items: (workflows ?? []).map((w) => ({
          id: w.id,
          name: w.name,
          folderId: w.folderId ?? null,
          sortOrder: w.sortOrder,
        })),
      },
      {
        type: 'folder' as const,
        items: (folders ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId ?? null,
          sortOrder: f.sortOrder,
        })),
      },
      {
        type: 'table' as const,
        items: (tables ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          folderId: t.folderId ?? null,
        })),
      },
      {
        type: 'dashboard' as const,
        items: (files ?? [])
          .filter((f) => f.type === DASHBOARD_CONTENT_TYPE)
          .map((f) => ({ id: f.id, name: dashboardDisplayName(f.name), folderId: null })),
      },
      {
        type: 'file' as const,
        items: (files ?? [])
          .filter((f) => f.type !== DASHBOARD_CONTENT_TYPE)
          .map((f) => ({ id: f.id, name: f.name, folderId: f.folderId ?? null })),
      },
      {
        type: 'filefolder' as const,
        items: (fileFolders ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId ?? null,
        })),
      },
      {
        type: 'knowledgebase' as const,
        items: (knowledgeBases ?? []).map((kb) => ({
          id: kb.id,
          name: kb.name,
          folderId: kb.folderId ?? null,
        })),
      },
      {
        type: 'integration' as const,
        items: listIntegrationsByPopularity().map((integration) => ({
          id: integration.blockType,
          name: integration.name,
          iconComponent: integration.icon,
          bgColor: integration.bgColor,
        })),
      },
      {
        type: 'task' as const,
        items: (tasks ?? []).map((t) => ({ id: t.id, name: t.name })),
      },
      /**
       * The chip's `name` keeps the absolute timestamp because it is persisted
       * with the chat, where "2m ago" would age into a lie; the row renders the
       * relative form, which is what reads at a glance. `mentionFamily` is what
       * lets `@logs` reach rows named after their workflow.
       */
      {
        type: 'log' as const,
        items: logs.map((log) => {
          const workflowName = log.workflow?.name ?? log.workflowId ?? 'Unknown'
          const when = formatDate(log.createdAt)
          return {
            id: log.id,
            name: `${workflowName} · ${when.compact}`,
            mentionFamily: getResourceConfig('log').label,
            executionId: log.executionId ?? undefined,
            workflowName,
            time: when.relative,
            status: log.status,
          }
        }),
      },
    ]
    // A new browser tab — desktop app only (needs the agent-browser bridge).
    // Every launch opens another page; the strip lists each as its own tab.
    if (browserAvailable) {
      groups.push({
        type: 'browser' as const,
        items: [
          {
            id: BROWSER_LAUNCHER_ID,
            name: 'Browser',
          },
        ],
      })
    }
    // The live terminal — desktop app only (needs the PTY bridge), and a
    // single top-level panel like the browser.
    if (terminalAvailable) {
      groups.push({
        type: 'terminal' as const,
        items: [
          {
            id: TERMINAL_LAUNCHER_ID,
            name: 'Terminal',
          },
        ],
      })
    }
    return groups.filter((g) => !excluded.has(g.type)).sort(byResourceMenuOrder)
  }, [
    enabled,
    browserAvailable,
    terminalAvailable,
    workflows,
    folders,
    fileFolders,
    tables,
    files,
    knowledgeBases,
    tasks,
    logs,
    excludeTypes,
    dashboardsEnabled,
  ])

  /**
   * Left in source order: `buildResourceFolderTree` orders each level by name,
   * interleaved with the items, matching the Tables and Knowledge pages. These
   * folders carry no user-defined ordering the way workflow folders do.
   */
  const structureFolders = useMemo<StructureFolders>(() => {
    const toFolderItems = (source: typeof tableFolders): AvailableItem[] =>
      (source ?? []).map((f) => ({ id: f.id, name: f.name, parentId: f.parentId ?? null }))
    return {
      table: toFolderItems(tableFolders),
      knowledgebase: toFolderItems(knowledgeBaseFolders),
    }
  }, [tableFolders, knowledgeBaseFolders])

  // `groups` and `structureFolders` keep their own stable identities so the
  // consumers' downstream memos still key on them; only this wrapper changes
  // when hydration settles.
  return useMemo(
    () => ({ groups, structureFolders, isHydrating }),
    [groups, structureFolders, isHydrating]
  )
}
