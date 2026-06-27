import type { ComponentType } from 'react'
import { Box, Database, File, Folder, Sparkles, Table, Workflow } from 'lucide-react'
import { getBlock } from '@/blocks/registry'
import type { MentionKind } from './types'

/** Icon component shape both the lucide kind-icons and the brand block icons satisfy. */
export type MentionIcon = ComponentType<{ className?: string }>

const KIND_ICONS: Record<Exclude<MentionKind, 'integration'>, MentionIcon> = {
  file: File,
  folder: Folder,
  table: Table,
  knowledge: Database,
  workflow: Workflow,
  skill: Sparkles,
}

/**
 * Resolves the icon for a mention. Integrations use their brand icon from the block registry (keyed by
 * blockType, which is the mention `id`), falling back to a generic icon if the block was since removed;
 * every other kind uses a lucide category icon, falling back to the same generic icon for an empty or
 * unrecognized kind (the schema default is `''`, and a `sim:` link could carry a kind a future version
 * adds) — so the result is always a real component and the chip is never icon-less. Shared by the menu
 * rows and the inserted chip so both render the same icon.
 */
export function mentionIcon(kind: MentionKind, id: string): MentionIcon {
  if (kind === 'integration') return (getBlock(id)?.icon as MentionIcon | undefined) ?? Box
  return KIND_ICONS[kind] ?? Box
}
