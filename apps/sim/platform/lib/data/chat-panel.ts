'use client'

import type { MothershipResource } from '@/lib/mothership/resources/types'
import { isWorkspaceResourceKind, workspaceResourcePath } from '@/lib/resources'
import type { PlatformResource } from '@/app/(product)/_components/chat/model'
import type { PanelResources } from '@/app/(product)/_components/chat/panel/model'
import type { useChat } from '@/hooks/mothership-chat/use-chat'
import type {
  useChatResourcePanel,
  useResourcePanelController,
} from '@/hooks/mothership-chat/use-resource-panel'
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

interface PanelResourcesOptions {
  chat: ReturnType<typeof useChat>
  panel: ReturnType<typeof useChatResourcePanel>
  controller: ReturnType<typeof useResourcePanelController>
}

/** The hook's tabs as the panel reads them. Selection stays in `?resource=`, owned by the hook. */
export function usePanelResources({
  chat,
  panel,
  controller,
}: PanelResourcesOptions): PanelResources {
  const scope = useOrganization()
  const resources: PlatformResource[] = chat.resources.map((resource) => ({
    id: resource.id,
    type: resource.type,
    title: resource.title,
    workspaceId: resource.workspaceId,
    href: resourceHref(scope, resource),
    active: resource.id === chat.activeResourceId,
    search: resource.search,
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
