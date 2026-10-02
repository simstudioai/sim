import type { ReactNode } from 'react'
import type { TabStripItem } from '@sim/emcn'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'

/** Navigation-only tabs share the strip without becoming agent resources. */
export interface ResourcePanelNavigation {
  control?: ReactNode
  tabs: TabStripItem[]
  active: boolean
  content: ReactNode
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  onBrowseResource: (resource: MothershipResource) => void
}
