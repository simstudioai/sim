'use client'

import { useEffect, useState } from 'react'
import { resolveFileCategory } from '@/components/file-viewer/file-category'
import { MENTION_BROWSE_LIMIT } from '@/lib/api/contracts/organization-mentions'
import type { MothershipResource } from '@/lib/mothership/resources/types'
import { requestTerminalFocus } from '@/lib/terminal/focus'
import { terminalIdFromResourceId } from '@/lib/terminal/resource-id'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file'
import { hasRenderableFilePreviewContent } from '@/hooks/mothership-chat/preview/use-file-preview-sessions'
import { useBrowserTabResources } from '@/hooks/mothership-chat/use-browser-tab-resources'
import type { useChat } from '@/hooks/mothership-chat/use-chat'
import type {
  useChatResourcePanel,
  useResourcePanelController,
} from '@/hooks/mothership-chat/use-resource-panel'
import { useTerminalTabResources } from '@/hooks/mothership-chat/use-terminal-tab-resources'
import { useOrganizationMentions } from '@/hooks/queries/organization-mentions'
import {
  grouped,
  useDashboardsShown,
  useMentionBrowse,
  useTestsShown,
} from '@/platform/lib/data/chat-mentions'
import {
  isPanelFamily,
  livesInWorkspace,
  pickedResource,
  resourceHref,
} from '@/platform/lib/data/chat-panel-model'
import type {
  ChatSource,
  FileStream,
  PlatformResource,
  PlatformTurn,
} from '@/platform/lib/data/models/chat'
import type { PanelPicker, PanelResources } from '@/platform/lib/data/models/chat-panel'
import { useOrganization } from '@/platform/lib/data/organization'

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
  /** A workspace chat's workspace, which its tabs stored before they named one live in. */
  chatWorkspaceId?: string
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
  chatWorkspaceId,
  turns,
  panel,
  controller,
}: PanelResourcesOptions): PanelResources {
  useBrowserTabResources(panel.desktopTabResourceOptions)
  useTerminalTabResources(panel.desktopTabResourceOptions)
  const scope = useOrganization()
  const dashboardsShown = useDashboardsShown()
  const testsShown = useTestsShown()
  const picker = usePanelPicker(panel, dashboardsShown)
  const locked = useAgentFileEditLock(chat.previewSession?.status === 'streaming', chat.isSending)
  const resources: PlatformResource[] = chat.resources.map((stored) => {
    const resource =
      stored.workspaceId || !chatWorkspaceId || !livesInWorkspace(stored.type)
        ? stored
        : { ...stored, workspaceId: chatWorkspaceId }
    return {
      id: resource.id,
      type: resource.type,
      title: resource.title,
      workspaceId: resource.workspaceId,
      href: resourceHref(scope, resource, { dashboards: dashboardsShown, tests: testsShown }),
      executionId: resource.executionId,
      active: resource.id === chat.activeResourceId,
      search: resource.search,
      sources: citedBy(resource, turns),
      stream: fileStreamFor(resource, chat.previewSession, locked, chat.desktopScopeId),
    }
  })
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
 * The panel's + picker over the organization's mention reads: each workspace with its most recently
 * updated tables, files, knowledge bases, workflows, logs and (while their tab is shown) dashboards,
 * and the menu's search answered by the server. A workspace is not itself a pick, so one with none
 * of those is not listed. Nothing is read until the picker first opens; a pick opens its tab and
 * shows it.
 */
function usePanelPicker(
  panel: ReturnType<typeof useChatResourcePanel>,
  dashboardsShown: boolean
): PanelPicker {
  const { organization } = useOrganization()
  const [enabled, setEnabled] = useState(false)
  const browse = useMentionBrowse(enabled, organization.id)
  const recent = useOrganizationMentions(
    organization.id,
    { query: '', limit: MENTION_BROWSE_LIMIT },
    { enabled: enabled && !browse.searching }
  )
  const rows = browse.searching
    ? browse.rows.filter((row) => isPanelFamily(row.family))
    : [
        ...browse.rows.filter((row) => row.family === 'workspaces'),
        ...(recent.data?.rows ?? []).filter((row) => isPanelFamily(row.family)),
      ]
  const logIds = new Map(
    rows.flatMap((row) =>
      row.family === 'logs' ? [[row.executionId ?? row.id, row.id] as const] : []
    )
  )
  return {
    items: grouped(rows, dashboardsShown),
    onOpen: () => setEnabled(true),
    onSearchChange: browse.onBrowseSearch,
    onSelect: (item) => {
      const resource = item.context && pickedResource(item.context, logIds)
      if (resource) panel.addResourceFromUser(resource)
    },
  }
}
