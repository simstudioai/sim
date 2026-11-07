import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import type { PlatformResource } from '@/platform/app/(shell)/_components/chat/model'

export type PanelRecent = {
  id: string
  label: string
} & (
  | { destination: 'workspace'; icon?: never; address?: never }
  | { destination: 'file' | 'website'; icon: IconName; address?: string }
)

/** A chat's resources as a panel reads them, whichever session holds them. */
export interface PanelResources {
  resources: readonly PlatformResource[]
  collapsed: boolean
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onExpand: () => void
  onCollapse: () => void
}

export interface PanelData {
  asOf: number
  recents: PanelRecent[]
  file: {
    title: string
    updatedAt: number
    properties: { label: string; value: string }[]
    sections: { title: string; text: string }[]
  }
  website: { name: string; address: string; image: string }
  terminal: string
}
