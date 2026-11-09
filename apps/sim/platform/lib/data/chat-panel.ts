'use client'

import type { MothershipResource } from '@/lib/mothership/resources/types'
import { isWorkspaceResourceKind, workspaceResourcePath } from '@/lib/resources'
import type {
  ChatSource,
  PlatformResource,
  PlatformTurn,
} from '@/app/(product)/_components/chat/model'
import type { PanelResources } from '@/app/(product)/_components/chat/panel/model'
import type { useChat } from '@/hooks/mothership-chat/use-chat'
import type {
  useChatResourcePanel,
  useResourcePanelController,
} from '@/hooks/mothership-chat/use-resource-panel'

const RESOURCE_KIND: Partial<Record<string, string>> = {
  knowledgebase: 'knowledge',
  filefolder: 'folder',
}

function resourceHref(resource: MothershipResource): string | undefined {
  if (!resource.workspaceId) return undefined
  const kind = RESOURCE_KIND[resource.type] ?? resource.type
  return isWorkspaceResourceKind(kind)
    ? workspaceResourcePath(resource.workspaceId, kind, resource.id)
    : `/workspace/${encodeURIComponent(resource.workspaceId)}/home?resource=${encodeURIComponent(resource.id)}`
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

/** The hook's tabs as the panel reads them. Selection stays in `?resource=`, owned by the hook. */
export function usePanelResources({
  chat,
  turns,
  panel,
  controller,
}: PanelResourcesOptions): PanelResources {
  const resources: PlatformResource[] = chat.resources.map((resource) => ({
    id: resource.id,
    type: resource.type,
    title: resource.title,
    workspaceId: resource.workspaceId,
    href: resourceHref(resource),
    active: resource.id === chat.activeResourceId,
    search: resource.search,
    sources: citedBy(resource, turns),
  }))
  return {
    resources,
    collapsed: controller.isResourceCollapsed,
    onSelect: panel.selectResourceFromUser,
    onRemove: (id) => {
      const resource = chat.resources.find((item) => item.id === id)
      if (resource) chat.removeResource(resource)
    },
    onExpand: panel.expandResource,
    onCollapse: panel.collapseResource,
  }
}
