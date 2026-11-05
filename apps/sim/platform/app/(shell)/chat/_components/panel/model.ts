import type { IconName } from '@/platform/design-system/catalog/icon-geometry'

export interface PanelRecent {
  id: string
  label: string
  icon: IconName
  destination: 'file' | 'workspace' | 'website'
  address?: string
}

export interface PanelData {
  recents: PanelRecent[]
  file: {
    title: string
    updated: string
    properties: { label: string; value: string }[]
    sections: { title: string; text: string }[]
  }
  website: { name: string; address: string; image: string }
  terminal: string
}
