'use client'

import type { MothershipResource } from '@/lib/mothership/resources/types'
import { isWorkspaceResourceKind, workspaceResourcePath } from '@/lib/resources'
import { requestTerminalFocus } from '@/lib/terminal/focus'
import { terminalIdFromResourceId } from '@/lib/terminal/resource-id'
import type {
  ChatSource,
  PlatformResource,
  PlatformTurn,
} from '@/app/(product)/_components/chat/model'
import type { PanelResources } from '@/app/(product)/_components/chat/panel/model'
import { useBrowserTabResources } from '@/hooks/mothership-chat/use-browser-tab-resources'
import type { useChat } from '@/hooks/mothership-chat/use-chat'
import type {
  useChatResourcePanel,
  useResourcePanelController,
} from '@/hooks/mothership-chat/use-resource-panel'
import { useTerminalTabResources } from '@/hooks/mothership-chat/use-terminal-tab-resources'
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
  return isWorkspaceResourceKind(kind)
    ? workspaceResourcePath(resource.workspaceId, kind, resource.id)
    : `${surfaceHref(scope, '/home')}?${new URLSearchParams({ resource: resource.id })}`
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
  const resources: PlatformResource[] = chat.resources.map((resource) => ({
    id: resource.id,
    type: resource.type,
    title: resource.title,
    workspaceId: resource.workspaceId,
    href: resourceHref(scope, resource),
    active: resource.id === chat.activeResourceId,
    search: resource.search,
    sources: citedBy(resource, turns),
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
  }
}
