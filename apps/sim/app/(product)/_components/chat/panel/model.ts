import type { FocusEvent, KeyboardEvent, PointerEvent } from 'react'
import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import type { PlatformResource } from '@/app/(product)/_components/chat/model'
import type {
  ComposerController,
  ComposerReference,
} from '@/app/(product)/_components/composer/model'

export type PanelRecent = {
  id: string
  label: string
} & (
  | { destination: 'workspace'; icon?: never; address?: never }
  | { destination: 'file' | 'website'; icon: IconName; address?: string }
)

/**
 * The divider between the chat and its panel: the panel element it measures and the handlers that
 * drag, step and report its width. Widths persist per viewer and chat.
 */
interface PanelResize {
  panelRef: (element: HTMLElement | null) => (() => void) | undefined
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onFocus: (event: FocusEvent<HTMLDivElement>) => void
}

/** The panel's + picker: the workspaces and families it browses, and what a pick opens. */
export interface PanelPicker {
  items: ComposerController['browse']
  /** The picker opened, which is when its reads start. */
  onOpen: () => void
  onSearchChange: (query: string) => void
  onSelect: (item: ComposerReference) => void
}

/** A chat's resources as a panel reads them, whichever session holds them. */
export interface PanelResources {
  resources: readonly PlatformResource[]
  collapsed: boolean
  /** `byPointer` when the reader clicked the tab; keyboard moves along the strip keep focus there. */
  onSelect: (id: string, byPointer: boolean) => void
  onRemove: (id: string) => void
  onExpand: () => void
  onCollapse: () => void
  resize: PanelResize
  /** Any pointer or key inside the panel: the reader now owns which tab it shows. */
  onInteraction: () => void
  /** The desktop scope whose native browser pages and shells this chat's tabs show. */
  desktopScopeId: string
  picker: PanelPicker
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
