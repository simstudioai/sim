import type { IconName } from '@/platform/design-system/catalog/icon-geometry'

export type PanelRecent = {
  id: string
  label: string
} & (
  | { destination: 'workspace'; icon?: never; address?: never }
  | { destination: 'file' | 'website'; icon: IconName; address?: string }
)

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
