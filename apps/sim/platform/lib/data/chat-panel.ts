'use client'

import { useEffect, useState } from 'react'
import { resolveFileCategory } from '@/components/file-viewer/file-category'
import type { MentionFamily } from '@/lib/api/contracts/organization-mentions'
import type { MothershipResource } from '@/lib/mothership/resources/types'
import { workspacePath } from '@/lib/navigation/paths'
import { isWorkspaceResourceKind, workspaceResourcePath } from '@/lib/resources'
import { requestTerminalFocus } from '@/lib/terminal/focus'
import { terminalIdFromResourceId } from '@/lib/terminal/resource-id'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file'
import type {
  ChatSource,
  FileStream,
  PlatformResource,
  PlatformTurn,
} from '@/app/(product)/_components/chat/model'
import type { PanelPicker, PanelResources } from '@/app/(product)/_components/chat/panel/model'
import { hasRenderableFilePreviewContent } from '@/hooks/mothership-chat/preview/use-file-preview-sessions'
import { useBrowserTabResources } from '@/hooks/mothership-chat/use-browser-tab-resources'
import type { useChat } from '@/hooks/mothership-chat/use-chat'
import type {
  useChatResourcePanel,
  useResourcePanelController,
} from '@/hooks/mothership-chat/use-resource-panel'
import { useTerminalTabResources } from '@/hooks/mothership-chat/use-terminal-tab-resources'
import { grouped, useMentionBrowse } from '@/platform/lib/data/chat-mentions'
import type { ChatContext } from '@/platform/lib/data/chat-types'
import { useOrganization } from '@/platform/lib/data/organization'
import { type SurfaceScope, surfaceHref } from '@/platform/lib/data/organization-model'

const RESOURCE_KIND: Partial<Record<string, string>> = {
  knowledgebase: 'knowledge',
  filefolder: 'folder',
}

/** A workspace resource opens on its workspace page; any other opens beside the organization's Home. */
function resourceHref(scope: SurfaceScope, resource: MothershipResource): string | undefined {
  if (!resource.workspaceId) return undefined
  const kind = RESOURCE_KIND[resource.type] ?? resource.type
  if (isWorkspaceResourceKind(kind))
    return workspaceResourcePath(resource.workspaceId, kind, resource.id)
  if (kind === 'dashboard') return workspacePath(resource.workspaceId, 'dashboards')
  if (kind === 'log' && resource.executionId)
    return workspacePath(resource.workspaceId, `logs/${encodeURIComponent(resource.executionId)}`)
  return `${surfaceHref(scope, '/home')}?${new URLSearchParams({ resource: resource.id })}`
}

/** A Sources tab lists what its answer cited; the transcript already holds that evidence. */
function citedBy(
  resource: MothershipResource,
  turns: readonly PlatformTurn[]
): readonly ChatSource[] | undefined {
  const address = resource.sources
  if (resource.type !== 'sources' || !address) return undefined
  const answer = turns.find(
    (turn) =>
      turn.role === 'assistant' &&
      (turn.id === address.messageId ||
        (address.requestId !== undefined && turn.requestId === address.requestId))
  )
  return answer?.role === 'assistant' ? (answer.sources ?? []) : []
}

/** The tab a new file streams into until it is stored and takes its own id. */
const STREAMING_FILE_ID = 'streaming-file'

/** Generated documents stream as the source their builder runs, not the binary it writes. */
const GENERATED_SOURCE_TYPES: Partial<Record<string, string>> = {
  pptx: 'text/x-pptxgenjs',
  docx: 'text/x-docxjs',
  pdf: 'text/x-pdflibjs',
}

const UNSAVED_FILE_DATE = new Date(0)

/**
 * How long a file stays locked after the agent stops streaming into it, bridging the gaps between
 * a file write's sequential sections rather than unlocking between them.
 */
const AGENT_EDIT_LOCK_GRACE_MS = 1500

/**
 * Holds a file read-only while the agent writes it, plus a short grace so brief gaps between edit
 * sections don't unlock it; it releases as soon as the turn ends.
 */
function useAgentFileEditLock(streaming: boolean, responding: boolean): boolean {
  const [locked, setLocked] = useState(streaming)
  useEffect(() => {
    if (streaming) {
      setLocked(true)
      return
    }
    if (!responding) {
      setLocked(false)
      return
    }
    const timer = setTimeout(() => setLocked(false), AGENT_EDIT_LOCK_GRACE_MS)
    return () => clearTimeout(timer)
  }, [streaming, responding])
  return locked
}

/** The record a file the agent is still creating shows under, named as the agent named it. */
function unsavedFile(fileName: string): NonNullable<FileStream['unsaved']> {
  const extension = getFileExtension(fileName)
  return {
    id: STREAMING_FILE_ID,
    workspaceId: '',
    name: fileName,
    key: '',
    path: '',
    size: 0,
    type: GENERATED_SOURCE_TYPES[extension] ?? getMimeTypeFromExtension(extension),
    uploadedBy: '',
    uploadedAt: UNSAVED_FILE_DATE,
    updatedAt: UNSAVED_FILE_DATE,
  }
}

/**
 * What the agent is writing into a tab: the chat's preview session, for the file it names or the
 * tab of a new file, once it has content to show. Text streams only while the write runs; once
 * it completes the stored file takes over.
 */
function fileStreamFor(
  resource: MothershipResource,
  session: ReturnType<typeof useChat>['previewSession'],
  locked: boolean,
  previewContextKey: string
): FileStream | undefined {
  if (!session || !hasRenderableFilePreviewContent(session)) return undefined
  const creating = resource.id === STREAMING_FILE_ID
  if (!creating && (resource.type !== 'file' || session.fileId !== resource.id)) return undefined
  const text = resolveFileCategory(null, session.fileName) === 'text-editable'
  return {
    unsaved: creating ? unsavedFile(session.fileName) : undefined,
    streamingContent: text && session.status === 'streaming' ? session.previewText : undefined,
    isAgentEditing: locked,
    streamIsIncremental: session.operation === 'append' || session.operation === 'patch',
    streamOperation: session.operation,
    disableStreamingAutoScroll: session.operation === 'patch',
    previewContextKey,
  }
}

interface PanelResourcesOptions {
  chat: ReturnType<typeof useChat>
  turns: readonly PlatformTurn[]
  panel: ReturnType<typeof useChatResourcePanel>
  controller: ReturnType<typeof useResourcePanelController>
}

/**
 * The hook's tabs as the panel reads them. Selection stays in `?resource=`, owned by the hook. In
 * the desktop app the chat's native browser pages and shells join them, one tab each, and a source link
 * clicked in the chat opens in a new one.
 */
export function usePanelResources({
  chat,
  turns,
  panel,
  controller,
}: PanelResourcesOptions): PanelResources {
  useBrowserTabResources(panel.desktopTabResourceOptions)
  useTerminalTabResources(panel.desktopTabResourceOptions)
  const scope = useOrganization()
  const picker = usePanelPicker(panel)
  const locked = useAgentFileEditLock(chat.previewSession?.status === 'streaming', chat.isSending)
  const resources: PlatformResource[] = chat.resources.map((resource) => ({
    id: resource.id,
    type: resource.type,
    title: resource.title,
    workspaceId: resource.workspaceId,
    href: resourceHref(scope, resource),
    executionId: resource.executionId,
    active: resource.id === chat.activeResourceId,
    search: resource.search,
    sources: citedBy(resource, turns),
    stream: fileStreamFor(resource, chat.previewSession, locked, chat.desktopScopeId),
  }))
  return {
    resources,
    collapsed: controller.isResourceCollapsed,
    onSelect: (id, byPointer) => {
      panel.selectResourceFromUser(id)
      const resource = chat.resources.find((item) => item.id === id)
      if (byPointer && resource?.type === 'terminal')
        requestTerminalFocus(terminalIdFromResourceId(id))
    },
    onRemove: (id) => {
      const resource = chat.resources.find((item) => item.id === id)
      if (resource) chat.removeResource(resource)
    },
    onExpand: panel.expandResource,
    onCollapse: panel.collapseResource,
    resize: {
      panelRef: panel.mothershipRef,
      onPointerDown: panel.handleResourceResizePointerDown,
      onKeyDown: panel.handleResourceResizeKeyDown,
      onFocus: panel.handleResourceResizeFocus,
    },
    onInteraction: panel.handleResourceInteraction,
    desktopScopeId: chat.desktopScopeId,
    picker,
  }
}

/**
 * The families a panel tab shows, as its + picker offers them. Chats, skills and workflow, table
 * and knowledge base folders open no tab of their own, as in legacy's picker.
 */
const PANEL_FAMILIES: ReadonlySet<MentionFamily> = new Set([
  'dashboards',
  'tables',
  'files',
  'file_folders',
  'knowledge_bases',
  'workflows',
  'logs',
])

/** The tab a picked reference opens, or nothing for a kind no tab shows. */
function pickedResource(
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
    case 'filefolder':
      return { ...owned, type: 'filefolder', id: context.fileFolderId }
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

/**
 * The panel's + picker over the organization's mention reads: workspaces, then each workspace's
 * families as it opens, with the menu's search answered by the server. Nothing is read until the
 * picker first opens; a pick opens its tab and shows it.
 */
function usePanelPicker(panel: ReturnType<typeof useChatResourcePanel>): PanelPicker {
  const { organization } = useOrganization()
  const [enabled, setEnabled] = useState(false)
  const browse = useMentionBrowse(enabled, organization.id)
  const rows = browse.rows.filter(
    (row) => PANEL_FAMILIES.has(row.family) || (row.family === 'workspaces' && !browse.searching)
  )
  const logIds = new Map(
    rows.flatMap((row) =>
      row.family === 'logs' ? [[row.executionId ?? row.id, row.id] as const] : []
    )
  )
  return {
    items: grouped(rows),
    onOpen: () => setEnabled(true),
    onSearchChange: browse.onBrowseSearch,
    onSelect: (item) => {
      const resource = item.context && pickedResource(item.context, logIds)
      if (resource) panel.addResourceFromUser(resource)
    },
  }
}
